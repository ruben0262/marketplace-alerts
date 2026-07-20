from datetime import UTC, datetime
from pathlib import Path

import pytest

from listing_monitor.config import AppConfig, SearchConfig, VintedConfig, VintedSite
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
