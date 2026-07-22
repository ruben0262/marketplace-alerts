from __future__ import annotations

import asyncio
import hashlib
import logging
import random
from collections.abc import Sequence

from .config import Config, SearchConfig
from .filtering import matches_required_brand, matches_search
from .marketplaces.base import MarketplaceAdapter, MarketplaceUnavailableError
from .models import Listing
from .state import StateStore
from .telegram import TelegramPublisher
from .translation import TranslationService

LOGGER = logging.getLogger(__name__)


class Monitor:
    """Polls each marketplace and reports genuinely new matches to Telegram.

    Contract for every listing a search returns:
      1. Skip it if its product ID is already handled (sent before) or already
         evaluated this scope, or if it fails the brand/keyword/size filters.
      2. On the very first run ever, silently seed the surviving matches so the
         pre-existing backlog is not announced. This is one-time and app-wide;
         retuning a search never re-seeds.
      3. Otherwise send it, and only mark it seen once the send succeeds — a
         failed send is retried on the next cycle rather than lost.
    """

    def __init__(
        self,
        config: Config,
        adapters: Sequence[MarketplaceAdapter],
        publisher: TelegramPublisher,
        state: StateStore,
        translator: TranslationService | None = None,
        *,
        dry_run: bool = False,
    ) -> None:
        self.config = config
        self.adapters = list(adapters)
        self.publisher = publisher
        self.state = state
        self.translator = translator
        self.dry_run = dry_run
        self._cycle_listing_cache: dict[str, Listing] = {}
        self._cycle_search_cache: dict[str, list[Listing]] = {}

    async def close(self) -> None:
        closers = [*(adapter.close() for adapter in self.adapters), self.publisher.close()]
        if self.translator:
            closers.append(self.translator.close())
        await asyncio.gather(*closers, return_exceptions=True)
        self.state.close()

    async def run(self, *, once: bool = False) -> None:
        # Safety net: abort a cycle that runs far longer than a healthy one (e.g. an
        # adapter request that hangs despite its own timeout) so the loop never freezes.
        cycle_timeout = max(300.0, self.config.app.poll_interval_seconds * 3)
        while True:
            try:
                await asyncio.wait_for(self.poll_once(), timeout=cycle_timeout)
            except TimeoutError:
                LOGGER.error("Polling cycle exceeded %.0fs and was aborted; continuing", cycle_timeout)
            except Exception:
                # Never let one bad cycle kill a 24/7 monitor; log and keep polling.
                LOGGER.exception("Polling cycle failed; continuing to next poll")
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
        # Seed silently only on the very first run ever; afterwards every match that
        # passes the filters is reported and marked seen only once the send succeeds.
        # This is app-wide, so retuning a search never re-absorbs new items unsent.
        initial_seed = (
            not self.state.is_initialized() and not self.config.app.send_existing_on_start
        )
        for adapter in self.adapters:
            for search in self.config.searches:
                if adapter.name not in search.sources:
                    continue
                scope = self._scope(adapter.name, search)
                try:
                    remote_scope = self._remote_scope(adapter.name, search)
                    listings = self._cycle_search_cache.get(remote_scope)
                    if listings is None:
                        listings = await adapter.search(search)
                        self._cycle_search_cache[remote_scope] = listings
                    if not self.dry_run:
                        new_product_count = self.state.track_discovered(listings)
                        if new_product_count:
                            LOGGER.info(
                                "%s / %s: recorded %d new product IDs",
                                adapter.name,
                                search.name,
                                new_product_count,
                            )
                    successful_searches += 1
                except MarketplaceUnavailableError as exc:
                    LOGGER.warning("%s searches unavailable: %s", adapter.name, exc)
                    break
                except Exception:
                    LOGGER.exception("%s search failed: %s", adapter.name, search.name)
                    continue
                await self._handle_results(
                    adapter, search, listings, scope=scope, initial_seed=initial_seed
                )
                if not self.dry_run:
                    self.state.flush()
        if not self.dry_run and successful_searches:
            # Only after a full successful cycle do we consider the backlog seeded.
            self.state.mark_initialized()
            self.state.flush()
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
        already_handled_count = 0
        already_processed_count = 0
        brand_rejected_count = 0
        filter_rejected_count = 0
        seeded_count = 0
        sent_count = 0
        failed_count = 0
        for listing in listings:
            if self.state.is_listing_seen(listing):
                already_handled_count += 1
                if not self.dry_run:
                    self.state.mark_processed(scope, listing.key)
                continue
            if self.state.is_processed(scope, listing.key):
                already_processed_count += 1
                continue
            if not matches_required_brand(listing, search, fallback_to_text=False):
                brand_rejected_count += 1
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
            if not self.dry_run:
                # Persist detail-enriched metadata even when local filters reject the product.
                self.state.track_discovered([listing])
            if not matches_search(listing, search):
                filter_rejected_count += 1
                if not self.dry_run:
                    self.state.mark_processed(scope, listing.key)
                continue
            match_count += 1
            if initial_seed:
                seeded_count += 1
                if not self.dry_run:
                    self.state.mark_seen(listing, sent=False)
                    self.state.mark_processed(scope, listing.key)
                continue
            if self.dry_run:
                LOGGER.info("DRY RUN new listing: %s | %s", listing.title, listing.url)
                continue
            if self.translator:
                await self.translator.translate_listing(listing)
            try:
                await self.publisher.send(listing)
            except Exception:
                failed_count += 1
                LOGGER.exception("Could not publish listing %s", listing.key)
                continue
            self.state.mark_seen(listing, sent=True)
            self.state.mark_processed(scope, listing.key)
            sent_count += 1
            LOGGER.info(
                "Sent %s product %s to Telegram: %s",
                listing.source,
                listing.listing_id,
                listing.title,
            )
        LOGGER.info(
            "%s / %s: %d fetched, %d matched, %d sent, %d seeded, "
            "%d already handled, %d already checked, %d brand rejected, "
            "%d filter rejected, %d send failed",
            adapter.name,
            search.name,
            len(listings),
            match_count,
            sent_count,
            seeded_count,
            already_handled_count,
            already_processed_count,
            brand_rejected_count,
            filter_rejected_count,
            failed_count,
        )

    @staticmethod
    def _scope(source: str, search: SearchConfig) -> str:
        payload = (
            source,
            search.name,
            search.query,
            tuple(sorted(search.sources)),
            search.max_age_hours,
            str(search.min_price) if search.min_price is not None else None,
            str(search.max_price) if search.max_price is not None else None,
            tuple(search.required_brands),
            tuple(search.excluded_sizes),
            tuple(search.include_keywords),
            tuple(tuple(group) for group in search.include_any_groups),
            tuple(search.exclude_keywords),
            tuple(search.ebay_category_ids),
            tuple(search.vinted_catalog_ids),
        )
        digest = hashlib.sha256(repr(payload).encode()).hexdigest()[:16]
        return f"{source}:{digest}"

    @staticmethod
    def _remote_scope(source: str, search: SearchConfig) -> str:
        """Fingerprint only fields sent to a marketplace, excluding local keyword rules."""
        payload = (
            source,
            search.query,
            search.max_age_hours if source == "ebay" else None,
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
