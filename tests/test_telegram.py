from decimal import Decimal

from listing_monitor.models import Listing
from listing_monitor.telegram import format_caption


def test_caption_escapes_html_and_respects_limit():
    item = Listing(
        "ebay",
        "EBAY_GB",
        "1",
        "Jacket <rare>",
        "https://example.test/item?a=1&b=2",
        price=Decimal("25"),
        currency="GBP",
        description="A & B " * 500,
        search_name="test",
    )
    caption = format_caption(item)
    assert "&lt;rare&gt;" in caption
    assert "Listing ID:" in caption
    assert "<code>1</code>" in caption
    assert len(caption) <= 1024
