from datetime import UTC, datetime, timedelta
from decimal import Decimal

from listing_monitor.models import Listing
from listing_monitor.telegram import format_caption, format_relative_age


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
    assert '<a href="https://example.test/item?a=1&amp;b=2">Visit product here</a>' in caption
    assert len(caption) <= 1024


def test_relative_listing_age_uses_readable_units():
    now = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
    assert format_relative_age(now - timedelta(minutes=12), now=now) == "12 minutes ago"
    assert format_relative_age(now - timedelta(hours=3), now=now) == "3 hours ago"
    assert format_relative_age(now - timedelta(days=2), now=now) == "2 days ago"
    assert format_relative_age(now - timedelta(days=14), now=now) == "2 weeks ago"
