from __future__ import annotations

import html
import logging
from decimal import Decimal

import httpx

from .config import AppConfig, TelegramConfig
from .http_client import HttpClient
from .models import Listing

LOGGER = logging.getLogger(__name__)


def _format_price(price: Decimal | None, currency: str | None) -> str:
    if price is None:
        return "Price not supplied"
    return f"{price:,.2f} {currency or ''}".strip()


def format_caption(listing: Listing, *, max_length: int = 1024) -> str:
    heading = f"<b>{html.escape(listing.title)}</b>"
    fields = [
        f"<b>Price:</b> {html.escape(_format_price(listing.price, listing.currency))}",
        f"<b>Source:</b> {html.escape(listing.marketplace)}",
        f"<b>Listing ID:</b> <code>{html.escape(listing.listing_id)}</code>",
        f"<b>Search:</b> {html.escape(listing.search_name)}",
    ]
    for name in ("Brand", "Size", "Color"):
        if value := listing.attributes.get(name):
            fields.append(f"<b>{name}:</b> {html.escape(value)}")
    if listing.created_at:
        fields.append(f"<b>Listed:</b> {html.escape(listing.created_at.isoformat())}")
    if listing.seller:
        fields.append(f"<b>Seller:</b> {html.escape(listing.seller)}")
    footer = f'<a href="{html.escape(listing.url, quote=True)}">Open listing</a>'
    fixed = "\n".join([heading, *fields, "", footer])
    if not listing.description:
        return fixed[:max_length]
    remaining = max_length - len(fixed) - 2
    description = html.escape(listing.description.strip())
    if remaining > 1 and len(description) > remaining:
        description = description[: remaining - 1].rstrip() + "…"
    return "\n".join([heading, *fields, "", description, "", footer])[:max_length]


class TelegramPublisher:
    def __init__(self, config: TelegramConfig, app: AppConfig, user_agent: str) -> None:
        self.config = config
        self.http = HttpClient(
            timeout=app.request_timeout_seconds,
            retries=app.request_retries,
            user_agent=user_agent,
        )
        self.base_url = f"https://api.telegram.org/bot{config.bot_token}"

    async def close(self) -> None:
        await self.http.close()

    async def send(self, listing: Listing) -> None:
        images = listing.image_urls[: self.config.max_images]
        try:
            if len(images) >= 2:
                await self._send_album(listing, images)
            elif images:
                await self._send_photo(listing, images[0])
            else:
                await self._send_text(listing)
        except (httpx.HTTPError, ValueError) as exc:
            if images:
                LOGGER.warning("Telegram could not fetch listing image; sending text: %s", exc)
                await self._send_text(listing)
            else:
                raise

    async def _send_album(self, listing: Listing, images: list[str]) -> None:
        media = []
        for index, url in enumerate(images):
            entry = {"type": "photo", "media": url}
            if index == 0:
                entry.update({"caption": format_caption(listing), "parse_mode": "HTML"})
            media.append(entry)
        await self.http.request_json(
            "POST",
            f"{self.base_url}/sendMediaGroup",
            json={
                "chat_id": self.config.chat_id,
                "media": media,
                "disable_notification": self.config.disable_notification,
            },
        )

    async def _send_photo(self, listing: Listing, image: str) -> None:
        await self.http.request_json(
            "POST",
            f"{self.base_url}/sendPhoto",
            json={
                "chat_id": self.config.chat_id,
                "photo": image,
                "caption": format_caption(listing),
                "parse_mode": "HTML",
                "disable_notification": self.config.disable_notification,
            },
        )

    async def _send_text(self, listing: Listing) -> None:
        await self.http.request_json(
            "POST",
            f"{self.base_url}/sendMessage",
            json={
                "chat_id": self.config.chat_id,
                "text": format_caption(listing, max_length=4096),
                "parse_mode": "HTML",
                "disable_web_page_preview": False,
                "disable_notification": self.config.disable_notification,
            },
        )
