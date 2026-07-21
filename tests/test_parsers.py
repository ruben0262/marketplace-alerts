from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from listing_monitor.config import (
    AppConfig,
    EbayConfig,
    EbayMarketplace,
    SearchConfig,
    VintedConfig,
    VintedSite,
)
from listing_monitor.marketplaces.base import MarketplaceUnavailableError
from listing_monitor.marketplaces.ebay import EbayAdapter
from listing_monitor.marketplaces.vinted import VintedAdapter


def test_ebay_parser():
    parsed = EbayAdapter._parse_item(
        {
            "itemId": "v1|123|0",
            "title": "Jacket",
            "itemWebUrl": "https://ebay.test/item/123",
            "price": {"value": "45.99", "currency": "GBP"},
            "image": {"imageUrl": "https://img.test/a.jpg"},
            "additionalImages": [{"imageUrl": "https://img.test/b.jpg"}],
            "itemCreationDate": "2026-01-02T03:04:05.000Z",
            "shortDescription": "A jacket",
            "condition": "Pre-owned - Good",
        },
        "EBAY_GB",
        "jackets",
    )
    assert parsed is not None
    assert str(parsed.price) == "45.99"
    assert len(parsed.image_urls) == 2
    assert parsed.created_at is not None
    assert parsed.attributes["Condition"] == "Pre-owned - Good"


@pytest.mark.asyncio
async def test_ebay_search_requests_newly_listed_order():
    adapter = EbayAdapter(
        EbayConfig(
            enabled=True,
            marketplaces=[EbayMarketplace("EBAY_GB", "GB")],
            pages_per_search=1,
            results_per_page=10,
        ),
        AppConfig(request_retries=1),
        "test",
    )
    adapter._access_token = AsyncMock(return_value="token")
    adapter.http.request_json = AsyncMock(return_value={"itemSummaries": []})

    await adapter.search(SearchConfig(name="latest", query="boxraw"))

    assert adapter.http.request_json.await_args.kwargs["params"]["sort"] == "newlyListed"
    await adapter.close()


@pytest.mark.asyncio
async def test_ebay_search_sends_supported_age_and_price_filters():
    adapter = EbayAdapter(
        EbayConfig(
            enabled=True,
            marketplaces=[EbayMarketplace("EBAY_GB", "GB", "GBP")],
            pages_per_search=1,
            results_per_page=10,
        ),
        AppConfig(request_retries=1),
        "test",
    )
    adapter._access_token = AsyncMock(return_value="token")
    adapter.http.request_json = AsyncMock(return_value={"itemSummaries": []})

    await adapter.search(
        SearchConfig(
            name="latest",
            query="boxraw",
            min_price=Decimal("20"),
            max_price=Decimal("100"),
            max_age_hours=24,
        )
    )

    filters = adapter.http.request_json.await_args.kwargs["params"]["filter"].split(",")
    assert "deliveryCountry:GB" in filters
    assert "price:[20..100]" in filters
    assert "priceCurrency:GBP" in filters
    assert any(value.startswith("itemStartDate:[") and value.endswith("Z]") for value in filters)
    await adapter.close()


@pytest.mark.asyncio
async def test_ebay_enrichment_uses_get_item_details():
    adapter = EbayAdapter(
        EbayConfig(
            enabled=True,
            marketplaces=[EbayMarketplace("EBAY_GB", "GB", "GBP")],
        ),
        AppConfig(request_retries=1),
        "test",
    )
    adapter._access_token = AsyncMock(return_value="token")
    adapter.http.request_json = AsyncMock(
        return_value={
            "title": "BOXRAW Hoodie",
            "itemWebUrl": "https://www.ebay.co.uk/itm/123",
            "price": {"value": "55", "currency": "GBP"},
            "description": "<p>Black training hoodie</p>",
            "itemCreationDate": "2026-01-02T03:04:05.000Z",
            "brand": "BOXRAW",
            "size": "XL",
            "condition": "Pre-owned - Excellent",
            "color": "Black",
            "localizedAspects": [{"name": "Department", "value": "Men"}],
            "seller": {"username": "seller"},
            "image": {"imageUrl": "https://img.test/a.jpg"},
            "additionalImages": [{"imageUrl": "https://img.test/b.jpg"}],
        }
    )
    listing = EbayAdapter._parse_item(
        {
            "itemId": "v1|123|0",
            "title": "BOXRAW Hoodie",
            "itemWebUrl": "https://www.ebay.co.uk/itm/123",
        },
        "EBAY_GB",
        "tops",
    )
    assert listing is not None

    await adapter.enrich(listing)

    request_url = adapter.http.request_json.await_args.args[1]
    assert request_url.endswith("/v1%7C123%7C0")
    assert listing.description == "Black training hoodie"
    assert listing.attributes["Brand"] == "BOXRAW"
    assert listing.attributes["Size"] == "XL"
    assert listing.attributes["Condition"] == "Pre-owned - Excellent"
    assert listing.attributes["Color"] == "Black"
    assert listing.attributes["Department"] == "Men"
    assert listing.image_urls == ["https://img.test/a.jpg", "https://img.test/b.jpg"]
    await adapter.close()


def test_vinted_parser_accepts_relative_url_and_scalar_price():
    parsed = VintedAdapter._parse_item(
        {
            "id": 42,
            "title": "Gloves",
            "url": "/items/42-gloves",
            "price": "12.50",
            "brand_title": "Example Brand",
            "size_title": "M",
            "photo": {
                "url": "https://img.test/gloves.jpg",
                "high_resolution": {"timestamp": 1760000000},
            },
        },
        "www.vinted.test",
        "gloves",
        "https://www.vinted.test",
    )
    assert parsed is not None
    assert parsed.url == "https://www.vinted.test/items/42-gloves"
    assert str(parsed.price) == "12.50"
    assert parsed.attributes == {"Brand": "Example Brand", "Size": "M"}
    assert parsed.created_at == datetime.fromtimestamp(1760000000, tz=UTC)


def test_vinted_detail_helpers_support_brand_dto_and_plugin_size():
    item = {
        "brand_dto": {"title": "Example Brand"},
        "plugins": [
            {
                "name": "attributes",
                "data": {"attributes": [{"code": "size", "data": {"value": "XL"}}]},
            }
        ],
        "photos": [{"high_resolution": {"timestamp": 1760000000}}],
    }
    assert VintedAdapter._brand(item) == "Example Brand"
    assert VintedAdapter._size(item) == "XL"
    assert VintedAdapter._created_at(item) == datetime.fromtimestamp(1760000000, tz=UTC)


def test_vinted_catalog_url_preserves_search_filters():
    url = VintedAdapter._catalog_url(
        VintedSite("https://www.vinted.test", "Test Vinted"),
        SearchConfig(
            name="gloves",
            query="example brand",
            min_price=10,
            max_price=50,
            vinted_catalog_ids=["12", "34"],
        ),
    )
    assert url.startswith("https://www.vinted.test/catalog?")
    assert "search_text=example+brand" in url
    assert "price_from=10" in url
    assert "price_to=50" in url
    assert "catalog%5B%5D=12" in url
    assert "catalog%5B%5D=34" in url


class FakeVintedClient:
    def __init__(self, items=None, details=None, error=None):
        self.items = items or []
        self.details = details or {}
        self.error = error
        self.calls = []
        self.detail_calls = []

    async def search_items(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.items

    async def item_details(self, url, *, raw_data):
        self.detail_calls.append((url, raw_data))
        if self.error:
            raise self.error
        return self.details

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_vinted_search_uses_newest_browser_client_and_cooldown(tmp_path: Path):
    site = VintedSite("https://www.vinted.test", "Test Vinted")
    config = VintedConfig(
        enabled=True,
        sites=[site],
        pages_per_search=1,
        results_per_page=5,
        cookies_dir=tmp_path,
        retry_cooldown_seconds=900,
    )
    adapter = VintedAdapter(config, AppConfig(), "unused")
    client = FakeVintedClient(
        items=[
            {
                "id": 42,
                "title": "Example gloves",
                "url": "/items/42-example-gloves",
                "price": {"amount": "12", "currency_code": "GBP"},
            }
        ]
    )
    adapter._clients[site.url] = client
    listings = await adapter.search(SearchConfig(name="gloves", query="example"))
    assert [listing.listing_id for listing in listings] == ["42"]
    assert client.calls[0]["order"] == "newest_first"
    assert client.calls[0]["raw_data"] is True

    blocked = FakeVintedClient(error=RuntimeError("blocked"))
    adapter._clients[site.url] = blocked
    with pytest.raises(MarketplaceUnavailableError):
        await adapter.search(SearchConfig(name="gloves", query="example"))
    with pytest.raises(MarketplaceUnavailableError):
        await adapter.search(SearchConfig(name="gloves", query="example"))
    assert len(blocked.calls) == 1
    await adapter.close()


@pytest.mark.asyncio
async def test_vinted_request_spacing_paces_consecutive_requests(tmp_path: Path):
    import time

    site = VintedSite("https://www.vinted.test", "Test Vinted")
    config = VintedConfig(
        enabled=True,
        sites=[site],
        pages_per_search=3,
        results_per_page=5,
        cookies_dir=tmp_path,
        request_spacing_seconds=0.05,
    )
    adapter = VintedAdapter(config, AppConfig(), "unused")
    adapter._clients[site.url] = FakeVintedClient(
        items=[
            {
                "id": 1,
                "title": "Example",
                "url": "/items/1-example",
                "price": {"amount": "5", "currency_code": "GBP"},
            }
            for _ in range(5)
        ]
    )
    start = time.monotonic()
    await adapter.search(SearchConfig(name="x", query="example"))
    elapsed = time.monotonic() - start
    # Three paced pages: gaps after the first two enforce at least 2 * spacing.
    assert elapsed >= 0.1
    await adapter.close()


@pytest.mark.asyncio
async def test_vinted_enrichment_delegates_current_detail_lookup(tmp_path: Path):
    site = VintedSite("https://www.vinted.test", "Test Vinted")
    config = VintedConfig(enabled=True, sites=[site], cookies_dir=tmp_path)
    adapter = VintedAdapter(config, AppConfig(), "unused")
    client = FakeVintedClient(
        details={
            "description": "Current item details",
            "brand_title": "Example Brand",
            "size_title": "XL",
        }
    )
    adapter._clients[site.url] = client
    listing = VintedAdapter._parse_item(
        {
            "id": 7564821986,
            "title": "Example hoodie",
            "url": "/items/7564821986-example-hoodie",
            "price": {"amount": "25", "currency_code": "EUR"},
        },
        "www.vinted.test",
        "hoodies",
        site.url,
    )
    assert listing is not None

    await adapter.enrich(listing)

    assert client.detail_calls == [(listing.url, True)]
    assert listing.description == "Current item details"
    assert listing.attributes["Brand"] == "Example Brand"
    assert listing.attributes["Size"] == "XL"
    await adapter.close()


@pytest.mark.asyncio
async def test_vinted_enrichment_cools_down_after_one_failure(tmp_path: Path):
    site = VintedSite("https://www.vinted.test", "Test Vinted")
    config = VintedConfig(
        enabled=True,
        sites=[site],
        cookies_dir=tmp_path,
        retry_cooldown_seconds=900,
    )
    adapter = VintedAdapter(config, AppConfig(), "unused")
    client = FakeVintedClient(error=RuntimeError("blocked"))
    adapter._clients[site.url] = client
    listing = VintedAdapter._parse_item(
        {
            "id": 42,
            "title": "Example hoodie",
            "url": "/items/42-example-hoodie",
            "price": {"amount": "25", "currency_code": "EUR"},
        },
        "www.vinted.test",
        "hoodies",
        site.url,
    )
    assert listing is not None

    await adapter.enrich(listing)
    await adapter.enrich(listing)

    assert len(client.detail_calls) == 1
    await adapter.close()
