from pathlib import Path

from listing_monitor.models import Listing
from listing_monitor.state import StateStore


def test_state_round_trip(tmp_path: Path):
    store = StateStore(tmp_path / "state.sqlite3")
    item = Listing("ebay", "EBAY_GB", "123", "Title", "https://example.test")
    assert not store.is_initialized("ebay:test")
    assert not store.is_seen(item.key)
    assert not store.is_processed("ebay:test", item.key)
    store.mark_seen(item, sent=True)
    store.mark_processed("ebay:test", item.key)
    store.mark_initialized("ebay:test")
    assert store.is_seen(item.key)
    assert store.is_processed("ebay:test", item.key)
    assert store.is_initialized("ebay:test")
    store.close()


def test_listing_key_includes_source_and_marketplace():
    first = Listing("ebay", "EBAY_GB", "123", "Title", "https://example.test/1")
    second = Listing("ebay", "EBAY_DE", "123", "Title", "https://example.test/2")
    third = Listing("vinted", "www.vinted.co.uk", "123", "Title", "https://example.test/3")
    assert len({first.key, second.key, third.key}) == 3
