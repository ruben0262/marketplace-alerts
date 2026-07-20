from datetime import UTC, datetime, timedelta
from decimal import Decimal

from listing_monitor.config import SearchConfig
from listing_monitor.filtering import matches_search
from listing_monitor.models import Listing


def listing(**overrides):
    values = {
        "source": "test",
        "marketplace": "test.example",
        "listing_id": "1",
        "title": "Black boxing tracksuit",
        "url": "https://example.test/1",
        "price": Decimal("50"),
        "description": "Size medium",
        "created_at": datetime.now(UTC),
    }
    values.update(overrides)
    return Listing(**values)


def test_filters_keywords_price_and_age():
    now = datetime.now(UTC)
    search = SearchConfig(
        name="tracksuits",
        query="tracksuit",
        include_keywords=["medium"],
        exclude_keywords=["poster"],
        min_price=Decimal("20"),
        max_price=Decimal("100"),
        max_age_hours=24,
    )
    assert matches_search(listing(created_at=now - timedelta(hours=2)), search, now=now)
    assert not matches_search(listing(title="Tracksuit poster"), search, now=now)
    assert not matches_search(listing(price=Decimal("101")), search, now=now)
    assert not matches_search(listing(created_at=now - timedelta(hours=25)), search, now=now)


def test_missing_timestamp_and_price_do_not_discard_listing():
    search = SearchConfig(
        name="tracksuits",
        query="tracksuit",
        min_price=Decimal("20"),
        max_age_hours=1,
    )
    assert matches_search(listing(price=None, created_at=None), search)


def test_each_keyword_group_requires_one_match_and_uses_attributes():
    search = SearchConfig(
        name="preferred tops",
        query="example brand",
        include_any_groups=[["xl", "xxl"], ["t-shirt", "hoodie"]],
    )
    item = listing(
        title="Example Brand training hoodie",
        description="Black",
        attributes={"Size": "XXL"},
    )
    assert matches_search(item, search)
    assert not matches_search(
        listing(title="Example Brand hoodie", attributes={"Size": "M"}), search
    )


def test_single_letter_size_does_not_match_inside_words():
    search = SearchConfig(name="shorts", query="example brand", include_any_groups=[["m"]])
    assert not matches_search(listing(title="Premium shorts"), search)
    assert matches_search(listing(title="Shorts", attributes={"Size": "M"}), search)
