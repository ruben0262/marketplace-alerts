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
        },
        "EBAY_GB",
        "jackets",
    )
    assert parsed is not None
    assert str(parsed.price) == "45.99"
    assert len(parsed.image_urls) == 2
    assert parsed.created_at is not None


def test_vinted_parser_accepts_relative_url_and_scalar_price():
    parsed = VintedAdapter._parse_item(
        {
            "id": 42,
            "title": "Gloves",
            "url": "/items/42-gloves",
            "price": "12.50",
            "photo": {"url": "https://img.test/gloves.jpg"},
        },
        "www.vinted.test",
        "gloves",
        "https://www.vinted.test",
    )
    assert parsed is not None
    assert parsed.url == "https://www.vinted.test/items/42-gloves"
    assert str(parsed.price) == "12.50"
