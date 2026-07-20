from pathlib import Path
from datetime import UTC, datetime, timedelta

import pytest

from listing_monitor.config import (
    AppConfig,
    Config,
    EbayConfig,
    SearchConfig,
    TelegramConfig,
    VintedConfig,
)
from listing_monitor.models import Listing
from listing_monitor.marketplaces.base import MarketplaceUnavailableError
from listing_monitor.monitor import Monitor
from listing_monitor.state import StateStore


class FakeAdapter:
    name = "ebay"

    def __init__(self, items):
        self.items = items
        self.search_calls = 0

    async def search(self, search):
        self.search_calls += 1
        return self.items.copy()

    async def enrich(self, listing):
        listing.description = "enriched"

    async def close(self):
        pass


class UnavailableAdapter(FakeAdapter):
    async def search(self, search):
        self.search_calls += 1
        raise MarketplaceUnavailableError("temporary outage")


class FakePublisher:
    def __init__(self):
        self.sent = []

    async def send(self, listing):
        self.sent.append(listing)

    async def close(self):
        pass


def make_config(database: Path, *, send_existing: bool = False):
    return Config(
        app=AppConfig(state_db=database, send_existing_on_start=send_existing),
        telegram=TelegramConfig("token", "chat"),
        ebay=EbayConfig(),
        vinted=VintedConfig(),
        searches=[SearchConfig(name="test", query="jacket", sources={"ebay"})],
        user_agent="test",
    )


@pytest.mark.asyncio
async def test_dry_run_does_not_change_state(tmp_path: Path):
    item = Listing("ebay", "EBAY_GB", "1", "Jacket", "https://example.test/1")
    config = make_config(tmp_path / "state.sqlite3")
    state = StateStore(config.app.state_db)
    publisher = FakePublisher()
    monitor = Monitor(config, [FakeAdapter([item])], publisher, state, dry_run=True)
    await monitor.poll_once()
    scope = monitor._scope("ebay", config.searches[0])
    assert not state.is_initialized(scope)
    assert not state.is_seen(item.key)
    assert not state.is_processed(scope, item.key)
    state.close()


@pytest.mark.asyncio
async def test_initial_cycle_seeds_then_new_item_is_sent(tmp_path: Path):
    old = Listing("ebay", "EBAY_GB", "1", "Old jacket", "https://example.test/1")
    new = Listing("ebay", "EBAY_GB", "2", "New jacket", "https://example.test/2")
    config = make_config(tmp_path / "state.sqlite3")
    state = StateStore(config.app.state_db)
    adapter = FakeAdapter([old])
    publisher = FakePublisher()
    monitor = Monitor(config, [adapter], publisher, state)
    await monitor.poll_once()
    assert publisher.sent == []
    adapter.items.append(new)
    await monitor.poll_once()
    assert publisher.sent == [new]
    state.close()


@pytest.mark.asyncio
async def test_identical_remote_queries_are_fetched_once_per_cycle(tmp_path: Path):
    item = Listing("ebay", "EBAY_GB", "1", "Example hoodie", "https://example.test/1")
    config = make_config(tmp_path / "state.sqlite3", send_existing=True)
    config.searches.append(
        SearchConfig(
            name="second local rule",
            query="jacket",
            sources={"ebay"},
            include_any_groups=[["hoodie"]],
        )
    )
    adapter = FakeAdapter([item])
    state = StateStore(config.app.state_db)
    monitor = Monitor(config, [adapter], FakePublisher(), state)
    await monitor.poll_once()
    assert adapter.search_calls == 1
    state.close()


@pytest.mark.asyncio
async def test_newest_listings_are_published_first(tmp_path: Path):
    now = datetime.now(UTC)
    older = Listing(
        "ebay",
        "EBAY_GB",
        "1",
        "Older jacket",
        "https://example.test/1",
        created_at=now - timedelta(hours=2),
    )
    newer = Listing(
        "ebay",
        "EBAY_GB",
        "2",
        "Newer jacket",
        "https://example.test/2",
        created_at=now - timedelta(minutes=2),
    )
    config = make_config(tmp_path / "state.sqlite3", send_existing=True)
    state = StateStore(config.app.state_db)
    publisher = FakePublisher()
    monitor = Monitor(config, [FakeAdapter([older, newer])], publisher, state)
    await monitor.poll_once()
    assert publisher.sent == [newer, older]
    state.close()


@pytest.mark.asyncio
async def test_unavailable_marketplace_stops_remaining_searches(tmp_path: Path):
    config = make_config(tmp_path / "state.sqlite3")
    config.searches.append(SearchConfig(name="second", query="shorts", sources={"ebay"}))
    state = StateStore(config.app.state_db)
    adapter = UnavailableAdapter([])
    monitor = Monitor(config, [adapter], FakePublisher(), state)
    await monitor.poll_once()
    assert adapter.search_calls == 1
    state.close()
