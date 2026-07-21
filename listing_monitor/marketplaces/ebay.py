from __future__ import annotations

import base64
import html
import logging
import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import httpx

from ..config import AppConfig, EbayConfig, SearchConfig
from ..http_client import HttpClient
from ..models import Listing, parse_datetime, parse_decimal
from .base import MarketplaceUnavailableError

LOGGER = logging.getLogger(__name__)


class EbayAdapter:
    name = "ebay"
    TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
    SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
    ITEM_URL = "https://api.ebay.com/buy/browse/v1/item"
    SCOPE = "https://api.ebay.com/oauth/api_scope"

    def __init__(self, config: EbayConfig, app: AppConfig, user_agent: str) -> None:
        self.config = config
        self.http = HttpClient(
            timeout=app.request_timeout_seconds,
            retries=app.request_retries,
            user_agent=user_agent,
        )
        self._token = ""
        self._token_expires_at = datetime.min.replace(tzinfo=UTC)
        self._details_unavailable_until = 0.0

    async def close(self) -> None:
        await self.http.close()

    async def enrich(self, listing: Listing) -> None:
        """Retrieve the full Browse item, including Brand, Size, and all images."""
        if not self.config.fetch_item_details:
            return
        if self._details_unavailable_until > time.monotonic():
            return
        token = await self._access_token()
        try:
            item = await self.http.request_json(
                "GET",
                f"{self.ITEM_URL}/{quote(listing.listing_id, safe='')}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-EBAY-C-MARKETPLACE-ID": listing.marketplace,
                },
            )
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 404:
                LOGGER.info(
                    "eBay product %s disappeared before details were fetched", listing.listing_id
                )
                return
            self._details_unavailable_until = (
                time.monotonic() + self.config.retry_cooldown_seconds
            )
            LOGGER.warning(
                "eBay item details unavailable (%s); using search data for %d seconds",
                self._error_message(exc),
                self.config.retry_cooldown_seconds,
            )
            return
        except (httpx.RequestError, ValueError) as exc:
            self._details_unavailable_until = (
                time.monotonic() + self.config.retry_cooldown_seconds
            )
            LOGGER.warning(
                "eBay item details unavailable (%s); using search data for %d seconds",
                type(exc).__name__,
                self.config.retry_cooldown_seconds,
            )
            return

        self._details_unavailable_until = 0.0
        listing.title = str(item.get("title") or listing.title).strip()
        listing.url = str(item.get("itemWebUrl") or listing.url).strip()
        price = item.get("price") or {}
        parsed_price = parse_decimal(price.get("value"))
        if parsed_price is not None:
            listing.price = parsed_price
        listing.currency = price.get("currency") or listing.currency
        description = self._plain_text(str(item.get("description", "")))
        listing.description = description or listing.description
        listing.created_at = listing.created_at or parse_datetime(item.get("itemCreationDate"))
        seller = item.get("seller") or {}
        listing.seller = seller.get("username") or listing.seller
        listing.attributes.update(self._attributes(item))
        images = self._images(item)
        if images:
            listing.image_urls = images

    async def _access_token(self) -> str:
        if self._token and datetime.now(UTC) < self._token_expires_at:
            return self._token
        raw = f"{self.config.client_id}:{self.config.client_secret}".encode()
        authorization = base64.b64encode(raw).decode()
        try:
            payload = await self.http.request_json(
                "POST",
                self.TOKEN_URL,
                headers={
                    "Authorization": f"Basic {authorization}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials", "scope": self.SCOPE},
            )
        except httpx.HTTPStatusError as exc:
            raise MarketplaceUnavailableError(
                f"eBay OAuth failed ({self._error_message(exc)}); verify that the App ID and "
                "Cert ID belong to the enabled Production keyset"
            ) from exc
        self._token = str(payload["access_token"])
        lifetime = max(int(payload.get("expires_in", 7200)) - 60, 60)
        self._token_expires_at = datetime.now(UTC) + timedelta(seconds=lifetime)
        return self._token

    async def search(self, search: SearchConfig) -> list[Listing]:
        token = await self._access_token()
        listings: dict[str, Listing] = {}
        for marketplace in self.config.marketplaces:
            headers = {
                "Authorization": f"Bearer {token}",
                "X-EBAY-C-MARKETPLACE-ID": marketplace.id,
            }
            for page in range(self.config.pages_per_search):
                filters = [f"deliveryCountry:{marketplace.delivery_country}"]
                if search.min_price is not None and search.max_price is not None:
                    filters.append(f"price:[{search.min_price}..{search.max_price}]")
                elif search.min_price is not None:
                    filters.append(f"price:[{search.min_price}..]")
                elif search.max_price is not None:
                    filters.append(f"price:[..{search.max_price}]")
                if search.min_price is not None or search.max_price is not None:
                    filters.append(f"priceCurrency:{marketplace.currency}")
                if search.max_age_hours is not None:
                    cutoff = datetime.now(UTC) - timedelta(hours=search.max_age_hours)
                    timestamp = cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    filters.append(f"itemStartDate:[{timestamp}]")
                params: dict[str, Any] = {
                    "q": search.query,
                    "limit": self.config.results_per_page,
                    "offset": page * self.config.results_per_page,
                    "sort": "newlyListed",
                    "fieldgroups": "EXTENDED",
                    "filter": ",".join(filters),
                }
                if search.ebay_category_ids:
                    params["category_ids"] = ",".join(search.ebay_category_ids)
                try:
                    data = await self.http.request_json(
                        "GET", self.SEARCH_URL, headers=headers, params=params
                    )
                except httpx.HTTPStatusError as exc:
                    raise MarketplaceUnavailableError(
                        f"{marketplace.id} Browse search failed ({self._error_message(exc)})"
                    ) from exc
                items = data.get("itemSummaries", [])
                if not isinstance(items, list):
                    break
                for item in items:
                    listing = self._parse_item(item, marketplace.id, search.name)
                    if listing:
                        listings[listing.key] = listing
                if len(items) < self.config.results_per_page:
                    break
        return list(listings.values())

    @staticmethod
    def _parse_item(item: dict[str, Any], marketplace: str, search_name: str) -> Listing | None:
        listing_id = str(item.get("itemId", "")).strip()
        title = str(item.get("title", "")).strip()
        url = str(item.get("itemWebUrl", "")).strip()
        if not listing_id or not title or not url:
            return None
        price = item.get("price") or {}
        image_urls = EbayAdapter._images(item)
        seller = item.get("seller") or {}
        attributes = EbayAdapter._attributes(item)
        return Listing(
            source="ebay",
            marketplace=marketplace,
            listing_id=listing_id,
            title=title,
            url=url,
            price=parse_decimal(price.get("value")),
            currency=price.get("currency"),
            description=str(item.get("shortDescription", "")),
            image_urls=image_urls,
            created_at=parse_datetime(item.get("itemCreationDate")),
            seller=seller.get("username"),
            search_name=search_name,
            attributes=attributes,
        )

    @staticmethod
    def _images(item: dict[str, Any]) -> list[str]:
        images: list[str] = []
        primary = (item.get("image") or {}).get("imageUrl")
        if primary:
            images.append(str(primary))
        for image in item.get("additionalImages") or []:
            image_url = image.get("imageUrl") if isinstance(image, dict) else None
            if image_url and image_url not in images:
                images.append(str(image_url))
        return images

    @staticmethod
    def _attributes(item: dict[str, Any]) -> dict[str, str]:
        attributes: dict[str, str] = {}
        for aspect in item.get("localizedAspects") or []:
            if not isinstance(aspect, dict) or not aspect.get("name"):
                continue
            value = aspect.get("value")
            if isinstance(value, list):
                value = ", ".join(str(part) for part in value if part is not None)
            if value not in (None, ""):
                attributes[str(aspect["name"])] = str(value)
        for field_name, label in (
            ("brand", "Brand"),
            ("size", "Size"),
            ("condition", "Condition"),
            ("color", "Color"),
            ("gender", "Gender"),
        ):
            if value := item.get(field_name):
                attributes[label] = str(value)
        return attributes

    @staticmethod
    def _plain_text(value: str) -> str:
        without_tags = re.sub(r"<[^>]+>", " ", value)
        return " ".join(html.unescape(without_tags).split())

    @staticmethod
    def _error_message(exc: httpx.HTTPStatusError) -> str:
        status = exc.response.status_code
        try:
            payload = exc.response.json()
        except ValueError:
            return f"HTTP {status}"
        messages: list[str] = []
        errors = payload.get("errors") if isinstance(payload, dict) else None
        if isinstance(errors, list):
            for error in errors:
                if not isinstance(error, dict):
                    continue
                error_id = error.get("errorId")
                message = error.get("message") or error.get("longMessage")
                if message:
                    messages.append(f"{error_id}: {message}" if error_id else str(message))
        elif isinstance(payload, dict):
            message = payload.get("error_description") or payload.get("error")
            if message:
                messages.append(str(message))
        return f"HTTP {status}" + (f"; {'; '.join(messages)}" if messages else "")
