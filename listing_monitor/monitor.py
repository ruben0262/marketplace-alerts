from __future__ import annotations

import asyncio
import hashlib
import logging
import random
from collections.abc import Sequence

from .config import Config, SearchConfig
from .filtering import matches_required_brand, matches_search
from .marketplaces.base import MarketplaceAdapter
from .models import Listing
from .state import StateStore
from .telegram import TelegramPublisher

LOGGER = logging.getLogger(__name__)


class Monitor:
    def __init__(
        self,
        config: Config,
        adapters: Sequence[MarketplaceAdapter],
        publisher: TelegramPublisher,
        state: StateStore,
        *,
        dry_run: bool = False,
    ) -> None:
        self.config = config
        self.adapters = list(adapters)
        self.publisher = publisher
        self.state = state
        self.dry_run = dry_run
        self._cycle_listing_cache: dict[str, Listing] = {}
        self._cycle_search_cache: dict[str, list[Listing]] = {}

    async def close(self) -> None:
        await asyncio.gather(
            *(adapter.close() for adapter in self.adapters),
            self.publisher.close(),
            return_exceptions=True,
        )
        self.state.close()

    async def run(self, *, once: bool = False) -> None:
        while True:
            await self.poll_once()
            if once:
                return
            delay = self.config.app.poll_interval_seconds + random.uniform(
                0, self.config.app.poll_jitter_seconds
            )
            LOGGER.info("Next poll in %.1f seconds", delay)
            await asyncio.sleep(delay)

    async def poll_once(self) -> None:
        self._cycle_listing_cache.clear()
        self._cycle_search_cache.clear()
        successful_searches = 0
        for adapter in self.adapters:
            for search in self.config.searches:
                if adapter.name not in search.sources:
                    continue
                scope = self._scope(adapter.name, search)
                initial_seed = (
                    not self.state.is_initialized(scope)
                    and not self.config.app.send_existing_on_start
                )
                try:
                    remote_scope = self._remote_scope(adapter.name, search)
                    listings = self._cycle_search_cache.get(remote_scope)
                    if listings is None:
                        listings = await adapter.search(search)
                        self._cycle_search_cache[remote_scope] = listings
                    successful_searches += 1
                except Exception:
                    LOGGER.exception("%s search failed: %s", adapter.name, search.name)
                    continue
                await self._handle_results(
                    adapter, search, listings, scope=scope, initial_seed=initial_seed
                )
                if not self.dry_run:
                    self.state.mark_initialized(scope)
        if not successful_searches:
            LOGGER.warning("No searches completed successfully; monitor remains uninitialized")

    async def _handle_results(
        self,
        adapter: MarketplaceAdapter,
        search: SearchConfig,
        listings: list[Listing],
        *,
        scope: str,
        initial_seed: bool,
    ) -> None:
        listings.sort(key=lambda item: item.created_at or self._minimum_datetime(), reverse=True)
        match_count = 0
        for listing in listings:
            if self.state.is_seen(listing.key):
                if not self.dry_run:
                    self.state.mark_processed(scope, listing.key)
                continue
            if self.state.is_processed(scope, listing.key):
                continue
            if not matches_required_brand(listing, search, fallback_to_text=False):
                if not self.dry_run:
                    self.state.mark_processed(scope, listing.key)
                continue
            cached = self._cycle_listing_cache.get(listing.key)
            if cached is None:
                await adapter.enrich(listing)
                self._cycle_listing_cache[listing.key] = listing
            else:
                listing = cached
            listing.search_name = search.name
            if not matches_search(listing, search):
                if not self.dry_run:
                    self.state.mark_processed(scope, listing.key)
                continue
            match_count += 1
            if initial_seed:
                if not self.dry_run:
                    self.state.mark_seen(listing, sent=False)
                    self.state.mark_processed(scope, listing.key)
                continue
            if self.dry_run:
                LOGGER.info("DRY RUN new listing: %s | %s", listing.title, listing.url)
                continue
            try:
                await self.publisher.send(listing)
            except Exception:
                LOGGER.exception("Could not publish listing %s", listing.key)
                continue
            self.state.mark_seen(listing, sent=True)
            self.state.mark_processed(scope, listing.key)
        LOGGER.info("%s: %d fetched, %d new matches", search.name, len(listings), match_count)

    @staticmethod
    def _scope(source: str, search: SearchConfig) -> str:
        digest = hashlib.sha256(f"{source}:{search!r}".encode()).hexdigest()[:16]
        return f"{source}:{digest}"

    @staticmethod
    def _remote_scope(source: str, search: SearchConfig) -> str:
        """Fingerprint only fields sent to a marketplace, excluding local keyword rules."""
        payload = (
            source,
            search.query,
            search.min_price,
            search.max_price,
            tuple(search.ebay_category_ids),
            tuple(search.vinted_catalog_ids),
        )
        return hashlib.sha256(repr(payload).encode()).hexdigest()

    @staticmethod
    def _minimum_datetime():
        from datetime import UTC, datetime

        return datetime.min.replace(tzinfo=UTC)
