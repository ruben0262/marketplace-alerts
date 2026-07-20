from __future__ import annotations

import base64
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from ..config import AppConfig, EbayConfig, SearchConfig
from ..http_client import HttpClient
from ..models import Listing, parse_datetime, parse_decimal

LOGGER = logging.getLogger(__name__)


class EbayAdapter:
    name = "ebay"
    TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
    SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
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

    async def close(self) -> None:
        await self.http.close()

    async def enrich(self, listing: Listing) -> None:
        # Search already requests the EXTENDED field group.
        return None

    async def _access_token(self) -> str:
        if self._token and datetime.now(UTC) < self._token_expires_at:
            return self._token
        raw = f"{self.config.client_id}:{self.config.client_secret}".encode()
        authorization = base64.b64encode(raw).decode()
        payload = await self.http.request_json(
            "POST",
            self.TOKEN_URL,
            headers={
                "Authorization": f"Basic {authorization}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials", "scope": self.SCOPE},
        )
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
                if search.min_price is not None:
                    filters.append(f"price:[{search.min_price}..]")
                if search.max_price is not None:
                    filters.append(f"price:[..{search.max_price}]")
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
                data = await self.http.request_json(
                    "GET", self.SEARCH_URL, headers=headers, params=params
                )
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
        image_urls: list[str] = []
        primary = (item.get("image") or {}).get("imageUrl")
        if primary:
            image_urls.append(str(primary))
        for image in item.get("additionalImages") or []:
            image_url = image.get("imageUrl") if isinstance(image, dict) else None
            if image_url and image_url not in image_urls:
                image_urls.append(str(image_url))
        seller = item.get("seller") or {}
        attributes = {
            str(aspect.get("name")): str(aspect.get("value"))
            for aspect in item.get("localizedAspects") or []
            if isinstance(aspect, dict) and aspect.get("name") and aspect.get("value")
        }
        if condition := item.get("condition"):
            attributes.setdefault("Condition", str(condition))
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
            created_at=parse_datetime(item.get("itemOriginDate") or item.get("itemCreationDate")),
            seller=seller.get("username"),
            search_name=search_name,
            attributes=attributes,
        )
