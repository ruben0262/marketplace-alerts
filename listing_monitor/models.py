from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None
    value = str(value)
    if value.isdigit():
        try:
            return datetime.fromtimestamp(int(value), tz=UTC)
        except (OSError, OverflowError, ValueError):
            return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or UTC).astimezone(UTC)


def parse_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


@dataclass(slots=True)
class Listing:
    source: str
    marketplace: str
    listing_id: str
    title: str
    url: str
    price: Decimal | None = None
    currency: str | None = None
    description: str = ""
    image_urls: list[str] = field(default_factory=list)
    created_at: datetime | None = None
    seller: str | None = None
    search_name: str = ""
    attributes: dict[str, str] = field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.source}:{self.marketplace}:{self.listing_id}"
