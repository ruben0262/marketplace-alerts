"""One isolated search for the Node scheduler. JSON in/out; no shared credentials."""
from __future__ import annotations

import asyncio
import json
import logging
import sys
from decimal import Decimal
from pathlib import Path

from .config import AppConfig, EbayConfig, EbayMarketplace, SearchConfig, VintedConfig, VintedSite, TranslationConfig
from .filtering import matches_required_brand, matches_search
from .marketplaces import EbayAdapter, VintedAdapter
from .translation import TranslationService

REGIONS = {"GB": ("co.uk", "GBP"), "FR": ("fr", "EUR"), "DE": ("de", "EUR"), "HU": ("hu", "HUF"), "NL": ("nl", "EUR"), "IT": ("it", "EUR"), "ES": ("es", "EUR"), "PL": ("pl", "PLN")}


async def run(payload):
    source, raw, settings, secrets = (payload[k] for k in ("source", "search", "settings", "secrets"))
    app = AppConfig(request_retries=1, request_timeout_seconds=15)
    search = SearchConfig(name=raw["name"], query=raw["query"], sources={source})
    for camel, snake in {"maxAgeHours": "max_age_hours", "requiredBrands": "required_brands", "excludedSizes": "excluded_sizes", "includeKeywords": "include_keywords", "excludeKeywords": "exclude_keywords", "includeAnyGroups": "include_any_groups", "ebayCategoryIds": "ebay_category_ids", "vintedCatalogIds": "vinted_catalog_ids"}.items():
        if camel in raw:
            setattr(search, snake, raw[camel])
    search.min_price = Decimal(str(raw["minPrice"])) if raw.get("minPrice") is not None else None
    search.max_price = Decimal(str(raw["maxPrice"])) if raw.get("maxPrice") is not None else None
    agent = settings.get("userAgent") or "marketplace-alerts/1.0"
    if source == "vinted":
        config = VintedConfig(enabled=True,
            sites=[VintedSite(f"https://www.vinted.{REGIONS[r][0]}", f"Vinted {r}") for r in settings.get("vintedRegions", ["GB"])],
            proxy=secrets.get("vintedProxy", "").removeprefix("http://").removeprefix("https://"),
            cookies_dir=Path("data/cookies") / payload["userId"],
            pages_per_search=settings.get("vintedPages", 2), results_per_page=settings.get("vintedPerPage", 15),
            probe_per_page=settings.get("vintedProbe", 5), fetch_item_details=settings.get("vintedDetails", False), request_spacing_seconds=1.0)
        adapter = VintedAdapter(config, app, agent)
        known_ids = set(raw.get("knownProductIds", {}).get("vinted", []))
        adapter.is_known = lambda listing: listing.listing_id in known_ids
    else:
        config = EbayConfig(enabled=True, client_id=secrets.get("ebayClientId", ""), client_secret=secrets.get("ebayClientSecret", ""),
            proxy=secrets.get("ebayProxy", ""),
            marketplaces=[EbayMarketplace(f"EBAY_{r}", r, REGIONS[r][1]) for r in settings.get("ebayRegions", ["GB"])],
            pages_per_search=settings.get("ebayPages", 2), results_per_page=settings.get("ebayPerPage", 50), fetch_item_details=settings.get("ebayDetails", True))
        adapter = EbayAdapter(config, app, agent)
    translator = TranslationService(TranslationConfig(enabled=settings.get("translation", False), api_key=secrets.get("deeplApiKey", "")), app, agent)
    try:
        listings = await adapter.search(search)
        results = {}
        for listing in listings:
            if not matches_required_brand(listing, search, fallback_to_text=False):
                continue
            await adapter.enrich(listing)
            if not matches_search(listing, search):
                continue
            await translator.translate_listing(listing)
            results[f"{source}:{listing.listing_id}"] = {
                "source": source, "productId": listing.listing_id, "title": listing.title,
                "url": listing.url, "price": str(listing.price) if listing.price is not None else None,
                "currency": listing.currency, "image": listing.image_urls[0] if listing.image_urls else None,
                "attributes": listing.attributes, "description": listing.description[:2000],
                "marketplace": listing.marketplace, "listedAt": listing.created_at.isoformat() if listing.created_at else None,
            }
        failed_regions = len(getattr(adapter, "_unavailable_until", {}))
        return {"items": list(results.values()), "knownProductIds": list(dict.fromkeys(listing.listing_id for listing in listings)), "scanned": len(listings), "warning": f"{failed_regions} region(s) unavailable; showing results from the others." if failed_regions else None}
    finally:
        await adapter.close()
        await translator.close()


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        print(json.dumps(asyncio.run(run(json.load(sys.stdin)))))
    except Exception as exc:
        # Deliberately omit exception text: transport failures may contain credentials.
        category = type(exc).__name__
        print(json.dumps({"error": f"Marketplace unavailable ({category}). Check credentials, region, and proxy settings; it will retry automatically."}))
        sys.exit(1)
