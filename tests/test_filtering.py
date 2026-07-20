from datetime import UTC, datetime, timedelta
from decimal import Decimal

from listing_monitor.config import SearchConfig
from listing_monitor.filtering import matches_search, normalize_brand, normalize_size
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


def test_required_brand_prefers_structured_brand_and_normalizes_formatting():
    search = SearchConfig(name="brand", query="brand", required_brands=["Box Raw"])
    assert normalize_brand(" BOX-RAW ") == "boxraw"
    assert matches_search(listing(attributes={"Brand": "BOX-RAW"}), search)
    assert not matches_search(
        listing(title="Box Raw style hoodie", attributes={"Brand": "Another Brand"}), search
    )


def test_required_brand_falls_back_to_title_when_attribute_is_missing():
    search = SearchConfig(name="brand", query="brand", required_brands=["Box Raw"])
    assert matches_search(listing(title="BOXRAW hoodie", attributes={}), search)
    assert not matches_search(listing(title="Generic hoodie", attributes={}), search)


def test_excluded_sizes_use_structured_exact_labels():
    search = SearchConfig(
        name="sizes",
        query="boxraw",
        excluded_sizes=["xs", "x-small", "extra small", "s", "small"],
    )
    assert not matches_search(listing(attributes={"Size": "S / 36 / 8"}), search)
    assert not matches_search(listing(attributes={"Size": "Extra Small"}), search)
    assert matches_search(listing(attributes={"Size": "M"}), search)
    assert matches_search(listing(attributes={"Size": "XXS"}), search)


def test_excluded_sizes_ignore_case_spaces_punctuation_and_localized_field_names():
    search = SearchConfig(name="sizes", query="boxraw", excluded_sizes=[" XS ", " S "])
    assert normalize_size(" X - Small ") == "xs"
    assert not matches_search(listing(attributes={"Taille": " X S / 34 / 6 "}), search)
    assert not matches_search(listing(attributes={"Gr\u00f6\u00dfe": " SMALL "}), search)
    assert not matches_search(listing(attributes={"Talla": "s-m"}), search)
    assert matches_search(listing(attributes={"Taglia": "XXS"}), search)


def test_size_fallback_avoids_substrings_and_possessives():
    search = SearchConfig(name="sizes", query="boxraw", excluded_sizes=["xs", "s"])
    assert not matches_search(listing(title="Boxraw hoodie XS", attributes={}), search)
    assert not matches_search(listing(title="Boxraw hoodie S", attributes={}), search)
    assert not matches_search(listing(title="Boxraw hoodie size X S", attributes={}), search)
    assert matches_search(listing(title="Men's Boxraw shorts", attributes={}), search)
