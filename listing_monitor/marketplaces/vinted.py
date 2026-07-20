from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

from ..config import AppConfig, SearchConfig, VintedConfig, VintedSite
from ..http_client import HttpClient
from ..models import Listing, parse_datetime, parse_decimal

LOGGER = logging.getLogger(__name__)


class VintedAdapter:
    """Best-effort adapter for Vinted's undocumented web catalog endpoint."""

    name = "vinted"

    def __init__(self, config: VintedConfig, app: AppConfig, user_agent: str) -> None:
        self.config = config
        self.http = HttpClient(
            timeout=app.request_timeout_seconds,
            retries=app.request_retries,
            user_agent=user_agent,
        )
        self._initialized_sites: set[str] = set()

    async def close(self) -> None:
        await self.http.close()

    async def _initialize_site(self, site: VintedSite) -> None:
        if site.url in self._initialized_sites:
            return
        # The home page establishes anonymous locale/session cookies used by the catalog.
        response = await self.http.client.get(
            site.url,
            headers={"Accept": "text/html,application/xhtml+xml"},
        )
        response.raise_for_status()
        self._initialized_sites.add(site.url)

    async def search(self, search: SearchConfig) -> list[Listing]:
        listings: dict[str, Listing] = {}
        completed_requests = 0
        for site in self.config.sites:
            try:
                await self._initialize_site(site)
            except Exception as exc:
                LOGGER.warning("Could not initialize %s: %s", site.name, exc)
                continue
            marketplace = urlparse(site.url).netloc
            for page in range(1, self.config.pages_per_search + 1):
                params: dict[str, Any] = {
                    "search_text": search.query,
                    "order": "newest_first",
                    "page": page,
                    "per_page": self.config.results_per_page,
                }
                if search.min_price is not None:
                    params["price_from"] = str(search.min_price)
                if search.max_price is not None:
                    params["price_to"] = str(search.max_price)
                if search.vinted_catalog_ids:
                    params["catalog_ids"] = ",".join(search.vinted_catalog_ids)
                try:
                    data = await self.http.request_json(
                        "GET", f"{site.url}/api/v2/catalog/items", params=params
                    )
                except Exception as exc:
                    LOGGER.warning("Catalog request failed for %s: %s", site.name, exc)
                    break
                completed_requests += 1
                items = data.get("items", [])
                if not isinstance(items, list):
                    break
                for item in items:
                    listing = self._parse_item(item, marketplace, search.name, site.url)
                    if listing:
                        listings[listing.key] = listing
                if len(items) < self.config.results_per_page:
                    break

        if not completed_requests:
            raise RuntimeError("No configured Vinted site completed a catalog request")
        return list(listings.values())

    async def enrich(self, listing: Listing) -> None:
        """Fetch detail fields only after the monitor establishes that an item is new."""
        if not self.config.fetch_item_details or listing.description:
            return
        base_url = f"https://{listing.marketplace}"
        try:
            data = await self.http.request_json(
                "GET", f"{base_url}/api/v2/items/{listing.listing_id}"
            )
        except Exception as exc:
            LOGGER.debug("Vinted detail lookup failed for %s: %s", listing.key, exc)
            return
        item = data.get("item") or {}
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
