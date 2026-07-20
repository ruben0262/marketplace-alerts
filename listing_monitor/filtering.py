from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime, timedelta

from .config import SearchConfig
from .models import Listing


def _contains(text: str, keyword: str) -> bool:
    """Match complete words/phrases so sizes such as M and XL do not hit substrings."""
    return re.search(rf"(?<!\w){re.escape(keyword.casefold())}(?!\w)", text) is not None


def normalize_brand(value: str) -> str:
    """Normalize case, accents, spaces, and punctuation for brand comparison."""
    normalized = unicodedata.normalize("NFKD", value.casefold())
    return "".join(character for character in normalized if character.isalnum())


def matches_required_brand(
    listing: Listing, search: SearchConfig, *, fallback_to_text: bool = True
) -> bool:
    if not search.required_brands:
        return True
    required = {normalize_brand(brand) for brand in search.required_brands}
    listed_brands = [
        value
        for name, value in listing.attributes.items()
        if normalize_brand(name) == "brand" and value
    ]
    if listed_brands:
        return any(normalize_brand(brand) in required for brand in listed_brands)
    if not fallback_to_text:
        # No structured brand yet; allow enrichment before deciding.
        return True
    searchable = normalize_brand(f"{listing.title} {listing.description}")
    return any(brand in searchable for brand in required)


def matches_search(listing: Listing, search: SearchConfig, *, now: datetime | None = None) -> bool:
    attributes = "\n".join(f"{name}: {value}" for name, value in listing.attributes.items())
    text = f"{listing.title}\n{listing.description}\n{attributes}".casefold()
    if not matches_required_brand(listing, search):
        return False
    if search.include_keywords and not all(
        _contains(text, word) for word in search.include_keywords
    ):
        return False
    if search.include_any_groups and not all(
        any(_contains(text, word) for word in group) for group in search.include_any_groups
    ):
        return False
    if any(_contains(text, word) for word in search.exclude_keywords):
        return False
    if listing.price is not None:
        if search.min_price is not None and listing.price < search.min_price:
            return False
        if search.max_price is not None and listing.price > search.max_price:
            return False
    if search.max_age_hours is not None and listing.created_at is not None:
        reference = (now or datetime.now(UTC)).astimezone(UTC)
        if listing.created_at < reference - timedelta(hours=search.max_age_hours):
            return False
    return True
