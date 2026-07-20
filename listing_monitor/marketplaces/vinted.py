from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
from urllib.parse import urlencode, urlparse

from vinted import VintedClient

from ..config import AppConfig, SearchConfig, VintedConfig, VintedSite
from ..models import Listing, parse_datetime, parse_decimal
from .base import MarketplaceUnavailableError

LOGGER = logging.getLogger(__name__)


class VintedAdapter:
    """Best-effort adapter backed by browser-compatible anonymous sessions."""

    name = "vinted"

    def __init__(self, config: VintedConfig, app: AppConfig, user_agent: str) -> None:
        self.config = config
        self._clients: dict[str, VintedClient] = {}
        self._unavailable_until: dict[str, float] = {}
        self._details_unavailable_until: dict[str, float] = {}

    async def close(self) -> None:
        await asyncio.gather(
            *(client.close() for client in self._clients.values()),
            return_exceptions=True,
        )

    def _client(self, site: VintedSite) -> VintedClient:
        client = self._clients.get(site.url)
        if client is not None:
            return client
        hostname = urlparse(site.url).netloc.replace(":", "_")
        cookies_dir = self.config.cookies_dir / hostname
        cookies_dir.mkdir(parents=True, exist_ok=True)
        client = VintedClient(
            proxy=self.config.proxy or None,
            cookies_dir=cookies_dir,
            persist_cookies=True,
            storage_format="json",
        )
        self._clients[site.url] = client
        return client

    def _available_sites(self) -> list[VintedSite]:
        now = time.monotonic()
        return [
            site for site in self.config.sites if self._unavailable_until.get(site.url, 0) <= now
        ]

    def _mark_unavailable(self, site: VintedSite, exc: Exception) -> None:
        self._unavailable_until[site.url] = time.monotonic() + self.config.retry_cooldown_seconds
        status = getattr(exc, "status_code", None)
        reason = f"HTTP {status}" if status else type(exc).__name__
        LOGGER.warning(
            "%s unavailable (%s); pausing that site for %d seconds",
            site.name,
            reason,
            self.config.retry_cooldown_seconds,
        )

    def _unavailable_message(self) -> str:
        now = time.monotonic()
        remaining = [max(0, int(deadline - now)) for deadline in self._unavailable_until.values()]
        retry_in = min(remaining, default=self.config.retry_cooldown_seconds)
        hint = " Configure VINTED_PROXY if this VPS IP is blocked." if not self.config.proxy else ""
        return f"all configured Vinted sites are unavailable; retry in about {retry_in}s.{hint}"

    @staticmethod
    def _catalog_url(site: VintedSite, search: SearchConfig) -> str:
        params: list[tuple[str, str]] = [("search_text", search.query)]
        if search.min_price is not None:
            params.append(("price_from", str(search.min_price)))
        if search.max_price is not None:
            params.append(("price_to", str(search.max_price)))
        params.extend(("catalog[]", catalog_id) for catalog_id in search.vinted_catalog_ids)
        return f"{site.url}/catalog?{urlencode(params)}"

    async def search(self, search: SearchConfig) -> list[Listing]:
        listings: dict[str, Listing] = {}
        completed_requests = 0
        available_sites = self._available_sites()
        if not available_sites:
            raise MarketplaceUnavailableError(self._unavailable_message())

        for site in available_sites:
            client = self._client(site)
            marketplace = urlparse(site.url).netloc
            catalog_url = self._catalog_url(site, search)
            for page in range(1, self.config.pages_per_search + 1):
                try:
                    items = await client.search_items(
                        url=catalog_url,
                        page=page,
                        per_page=self.config.results_per_page,
                        order="newest_first",
                        raw_data=True,
                    )
                except Exception as exc:
                    self._mark_unavailable(site, exc)
                    break
                self._unavailable_until.pop(site.url, None)
                completed_requests += 1
                if not isinstance(items, list):
                    break
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    listing = self._parse_item(item, marketplace, search.name, site.url)
                    if listing:
                        listings[listing.key] = listing
                if len(items) < self.config.results_per_page:
                    break

        if not completed_requests:
            raise MarketplaceUnavailableError(self._unavailable_message())
        return list(listings.values())

    async def enrich(self, listing: Listing) -> None:
        """Fetch detail fields only after the monitor establishes that an item is new."""
        if not self.config.fetch_item_details or listing.description:
            return
        base_url = f"https://{listing.marketplace}"
        site = next((item for item in self.config.sites if item.url == base_url), None)
        if site is None:
            return
        if self._details_unavailable_until.get(site.url, 0) > time.monotonic():
            return
        try:
            item = await self._client(site).item_details(listing.url, raw_data=True)
        except Exception as exc:
            self._details_unavailable_until[site.url] = (
                time.monotonic() + self.config.retry_cooldown_seconds
            )
            status = getattr(exc, "status_code", None)
            reason = f"HTTP {status}" if status else type(exc).__name__
            LOGGER.warning(
                "%s item details unavailable (%s); using catalog data for %d seconds",
                site.name,
                reason,
                self.config.retry_cooldown_seconds,
            )
            return
        self._details_unavailable_until.pop(site.url, None)
        if not isinstance(item, dict):
            return
        listing.description = str(item.get("description", ""))
        listing.created_at = self._created_at(item) or listing.created_at
        user = item.get("user") or {}
        listing.seller = user.get("login")
        brand = self._brand(item)
        size = self._size(item)
        if brand:
            listing.attributes["Brand"] = brand
        if size:
            listing.attributes["Size"] = size
        for field_name, label in (
            ("status", "Condition"),
            ("color1", "Color"),
            ("color2", "Secondary color"),
        ):
            value = item.get(field_name)
            if value:
                listing.attributes[label] = str(value)
        images: list[str] = []
        for photo in item.get("photos") or []:
            if not isinstance(photo, dict):
                continue
            image_url = photo.get("full_size_url") or photo.get("url")
            if image_url and image_url not in images:
                images.append(str(image_url))
        if images:
            listing.image_urls = images

    @staticmethod
    def _parse_item(
        item: dict[str, Any], marketplace: str, search_name: str, base_url: str
    ) -> Listing | None:
        listing_id = str(item.get("id", "")).strip()
        title = str(item.get("title", "")).strip()
        url = str(item.get("url", "")).strip()
        if url.startswith("/"):
            url = f"{base_url}{url}"
        if not listing_id or not title or not url:
            return None
        price = item.get("price") or {}
        if not isinstance(price, dict):
            price = {"amount": price}
        photo = item.get("photo") or {}
        photo_url = photo.get("full_size_url") or photo.get("url")
        attributes = {}
        brand = VintedAdapter._brand(item)
        size = VintedAdapter._size(item)
        if brand:
            attributes["Brand"] = brand
        if size:
            attributes["Size"] = size
        if status := item.get("status"):
            attributes["Condition"] = str(status)
        return Listing(
            source="vinted",
            marketplace=marketplace,
            listing_id=listing_id,
            title=title,
            url=url,
            price=parse_decimal(price.get("amount")),
            currency=price.get("currency_code") or price.get("currency"),
            description=str(item.get("description", "")),
            image_urls=[str(photo_url)] if photo_url else [],
            created_at=VintedAdapter._created_at(item),
            search_name=search_name,
            attributes=attributes,
        )

    @staticmethod
    def _brand(item: dict[str, Any]) -> str:
        brand_dto = item.get("brand_dto") or {}
        return str(item.get("brand_title") or brand_dto.get("title") or "").strip()

    @staticmethod
    def _size(item: dict[str, Any]) -> str:
        if size := item.get("size_title"):
            return str(size).strip()
        for plugin in item.get("plugins") or []:
            if not isinstance(plugin, dict) or plugin.get("name") != "attributes":
                continue
            for attribute in (plugin.get("data") or {}).get("attributes") or []:
                if isinstance(attribute, dict) and attribute.get("code") == "size":
                    value = (attribute.get("data") or {}).get("value")
                    return str(value).strip() if value is not None else ""
        return ""

    @staticmethod
    def _created_at(item: dict[str, Any]):
        direct = parse_datetime(item.get("created_at_ts") or item.get("created_at"))
        if direct:
            return direct
        photos = item.get("photos") or []
        photo = photos[0] if photos else item.get("photo") or {}
        if not isinstance(photo, dict):
            return None
        timestamp = (photo.get("high_resolution") or {}).get("timestamp")
        return parse_datetime(timestamp)
