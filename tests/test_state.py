import json
import sqlite3
from pathlib import Path

from listing_monitor.models import Listing
from listing_monitor.state import StateStore


def test_json_state_round_trip_and_indexes(tmp_path: Path):
    path = tmp_path / "listings.json"
    store = StateStore(path)
    item = Listing("ebay", "EBAY_GB", "123", "Title", "https://example.test")
    store.track_discovered([item])
    assert item.key in store.items
    assert not store.is_initialized("ebay:test")
    assert not store.is_seen(item.key)
    assert not store.is_processed("ebay:test", item.key)
    store.mark_seen(item, sent=True)
    store.mark_processed("ebay:test", item.key)
    store.mark_initialized("ebay:test")
    store.close()

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["version"] == 1
    assert payload["items"][item.key]["handled"] is True
    assert not path.with_name("listings.json.tmp").exists()

    reopened = StateStore(path)
    assert reopened.is_seen(item.key)
    assert reopened.is_processed("ebay:test", item.key)
    assert reopened.is_initialized("ebay:test")
    reopened.close()


def test_sqlite_history_is_migrated_without_losing_duplicate_protection(tmp_path: Path):
    legacy = tmp_path / "listings.sqlite3"
    connection = sqlite3.connect(legacy)
    connection.executescript(
        """
        CREATE TABLE seen_listings (
            listing_key TEXT PRIMARY KEY,
            source TEXT,
            marketplace TEXT,
            listing_id TEXT,
            first_seen_at TEXT,
            sent_at TEXT
        );
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE processed_listings (
            scope TEXT,
            listing_key TEXT,
            processed_at TEXT
        );
        """
    )
    key = "vinted:www.vinted.test:123"
    connection.execute(
        "INSERT INTO seen_listings VALUES (?, 'vinted', 'www.vinted.test', '123', ?, ?)",
        (key, "2026-07-20T10:00:00+00:00", "2026-07-20T10:01:00+00:00"),
    )
    connection.execute("INSERT INTO metadata VALUES ('initialized:vinted:test', '1')")
    connection.execute(
        "INSERT INTO processed_listings VALUES ('vinted:test', ?, ?)",
        (key, "2026-07-20T10:01:00+00:00"),
    )
    connection.commit()
    connection.close()

    json_path = tmp_path / "listings.json"
    store = StateStore(json_path, legacy_sqlite_path=legacy)
    assert store.is_seen(key)
    assert store.is_processed("vinted:test", key)
    assert store.is_initialized("vinted:test")
    assert json_path.exists()
    store.close()


def test_listing_key_includes_source_and_marketplace():
    first = Listing("ebay", "EBAY_GB", "123", "Title", "https://example.test/1")
    second = Listing("ebay", "EBAY_DE", "123", "Title", "https://example.test/2")
    third = Listing("vinted", "www.vinted.co.uk", "123", "Title", "https://example.test/3")
    assert len({first.key, second.key, third.key}) == 3
