from __future__ import annotations

from typing import Protocol

from ..config import SearchConfig
from ..models import Listing


class MarketplaceUnavailableError(RuntimeError):
    """Raised when a marketplace is temporarily unavailable to this process."""


class MarketplaceAdapter(Protocol):
    name: str

    async def search(self, search: SearchConfig) -> list[Listing]: ...

    async def enrich(self, listing: Listing) -> None: ...

    async def close(self) -> None: ...
