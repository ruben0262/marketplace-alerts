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


SIZE_ATTRIBUTE_NAMES = {
    "size",
    "taille",
    "gro\u00dfe",
    "grosse",
    "groesse",
    "talla",
    "taglia",
    "maat",
}
SIZE_ALIASES = {
    "small": "s",
    "xsmall": "xs",
    "extrasmall": "xs",
}


def normalize_size(value: str) -> str:
    """Normalize a size label for case/space/punctuation-insensitive comparison."""
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    compact = "".join(
        character
        for character in decomposed
        if character.isalnum() and not unicodedata.combining(character)
    )
    return SIZE_ALIASES.get(compact, compact)


def _size_candidates(value: str) -> set[str]:
    """Return complete size tokens without matching letters inside ordinary words."""
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    normalized = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    # Prevent possessive/contraction endings in "men's" and "it's" becoming size S.
    normalized = re.sub(r"(?<=\w)['\u2019]s\b", "", normalized)
    tokens = re.findall(r"[a-z0-9]+", normalized)
    candidates = {normalize_size(token) for token in tokens}
    # Join nearby tokens so X S, X-Small, and Extra Small compare like xs.
    for width in (2, 3):
        candidates.update(
            normalize_size("".join(tokens[index : index + width]))
            for index in range(len(tokens) - width + 1)
        )
    candidates.add(normalize_size(normalized))
    candidates.discard("")
    return candidates


def matches_excluded_sizes(listing: Listing, search: SearchConfig) -> bool:
    if not search.excluded_sizes:
        return True
    excluded = {normalize_size(size) for size in search.excluded_sizes}
    structured_sizes = [
        value
        for name, value in listing.attributes.items()
        if normalize_brand(name) in SIZE_ATTRIBUTE_NAMES and value
    ]
    values = structured_sizes or [f"{listing.title}\n{listing.description}"]
    return not any(_size_candidates(value) & excluded for value in values)


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
    if not matches_excluded_sizes(listing, search):
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
