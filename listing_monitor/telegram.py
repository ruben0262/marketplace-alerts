from __future__ import annotations

import asyncio
import html
import logging
import time
from datetime import UTC, datetime
from decimal import Decimal

import httpx

from .config import AppConfig, TelegramConfig
from .http_client import HttpClient, retry_after_seconds
from .models import Listing

LOGGER = logging.getLogger(__name__)


def _format_price(price: Decimal | None, currency: str | None) -> str:
    if price is None:
        return "Price not supplied"
    return f"{price:,.2f} {currency or ''}".strip()


def format_relative_age(created_at: datetime, *, now: datetime | None = None) -> str:
    reference = (now or datetime.now(UTC)).astimezone(UTC)
    created = created_at.replace(tzinfo=created_at.tzinfo or UTC).astimezone(UTC)
    seconds = max(0, int((reference - created).total_seconds()))

    if seconds < 60:
        return "just now"
    if seconds < 3600:
        value, unit = seconds // 60, "minute"
    elif seconds < 86400:
        value, unit = seconds // 3600, "hour"
    elif seconds < 604800:
        value, unit = seconds // 86400, "day"
    elif seconds < 2592000:
        value, unit = seconds // 604800, "week"
    elif seconds < 31536000:
        value, unit = seconds // 2592000, "month"
    else:
        value, unit = seconds // 31536000, "year"
    suffix = "" if value == 1 else "s"
    return f"{value} {unit}{suffix} ago"


def _truncate_and_escape(value: str, limit: int) -> str:
    escaped = html.escape(value.strip())
    if len(escaped) <= limit:
        return escaped
    suffix = "..."
    low, high = 0, len(value)
    while low < high:
        middle = (low + high + 1) // 2
        if len(html.escape(value[:middle].rstrip())) + len(suffix) <= limit:
            low = middle
        else:
            high = middle - 1
    return html.escape(value[:low].rstrip()) + suffix


def format_caption(listing: Listing, *, max_length: int = 1024) -> str:
    heading = f"<b>{html.escape(listing.title)}</b>"
    # No links in the body; the product link is delivered as an inline button.
    fields = [
        f"<b>Price:</b> {html.escape(_format_price(listing.price, listing.currency))}",
    ]
    for name in ("Brand", "Size", "Condition", "Color"):
        if value := listing.attributes.get(name):
            fields.append(f"<b>{name}:</b> {html.escape(value)}")
    fields.append(f"<b>Marketplace:</b> {html.escape(listing.marketplace)}")
    if listing.search_name:
        fields.append(f"<b>Search:</b> {html.escape(listing.search_name)}")
    if listing.created_at:
        fields.append(f"<b>Listed:</b> {format_relative_age(listing.created_at)}")
    if listing.seller:
        fields.append(f"<b>Seller:</b> {html.escape(listing.seller)}")

    fixed = "\n".join([heading, *fields])
    if not listing.description:
        return fixed[:max_length]
    remaining = max(max_length - len(fixed) - 2, 0)
    description = _truncate_and_escape(listing.description, remaining)
    return f"{fixed}\n\n{description}"[:max_length]


class TelegramPublisher:
    def __init__(self, config: TelegramConfig, app: AppConfig, user_agent: str) -> None:
        self.config = config
        self.http = HttpClient(
            timeout=app.request_timeout_seconds,
            retries=app.request_retries,
            user_agent=user_agent,
        )
        self.base_url = f"https://api.telegram.org/bot{config.bot_token}"
        self._send_lock = asyncio.Lock()
        self._next_send_at = 0.0

    async def close(self) -> None:
        await self.http.close()

    @staticmethod
    def _product_button(listing: Listing) -> dict | None:
        """Inline 'Visit product' button; None when the URL is unusable."""
        if listing.url.startswith("http"):
            return {"inline_keyboard": [[{"text": "Visit product", "url": listing.url}]]}
        return None

    async def send(self, listing: Listing) -> None:
        image = listing.image_urls[0] if listing.image_urls else None
        try:
            if image:
                await self._send_photo(listing, image)
            else:
                await self._send_text(listing)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429:
                raise
            if image:
                LOGGER.warning("Telegram could not fetch listing image; sending text: %s", exc)
                await self._send_text(listing)
            else:
                raise
        except (httpx.RequestError, ValueError) as exc:
            if image:
                LOGGER.warning("Telegram could not fetch listing image; sending text: %s", exc)
                await self._send_text(listing)
            else:
                raise

    async def _request(self, method: str, payload: dict, *, message_count: int = 1) -> None:
        async with self._send_lock:
            delay = self._next_send_at - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            try:
                await self.http.request_json(
                    "POST",
                    f"{self.base_url}/{method}",
                    json=payload,
                )
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    retry_after = retry_after_seconds(exc.response)
                    self._next_send_at = time.monotonic() + max(
                        retry_after or 0,
                        self.config.min_send_interval_seconds,
                    )
                raise
            self._next_send_at = time.monotonic() + (
                self.config.min_send_interval_seconds * max(1, message_count)
            )

    async def _send_photo(self, listing: Listing, image: str) -> None:
        payload = {
            "chat_id": self.config.chat_id,
            "photo": image,
            "caption": format_caption(listing),
            "parse_mode": "HTML",
            "disable_notification": self.config.disable_notification,
        }
        if button := self._product_button(listing):
            payload["reply_markup"] = button
        await self._request("sendPhoto", payload)

    async def _send_text(self, listing: Listing) -> None:
        payload = {
            "chat_id": self.config.chat_id,
            "text": format_caption(listing, max_length=4096),
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
            "disable_notification": self.config.disable_notification,
        }
        if button := self._product_button(listing):
            payload["reply_markup"] = button
        await self._request("sendMessage", payload)
