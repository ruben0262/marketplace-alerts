import json
import sqlite3
from decimal import Decimal
from pathlib import Path

from listing_monitor.models import Listing
from listing_monitor.state import StateStore


def test_json_state_round_trip_and_indexes(tmp_path: Path):
    path = tmp_path / "listings.json"
    store = StateStore(path)
    item = Listing(
        "ebay",
        "EBAY_GB",
        "123",
        "Title",
        "https://example.test",
        price=Decimal("25.50"),
        currency="GBP",
        description="Black hoodie",
        image_urls=["https://example.test/image.jpg"],
        search_name="Boxraw tops",
        attributes={"Brand": "Boxraw", "Size": "XL"},
    )
    assert store.track_discovered([item]) == 1
    assert store.track_discovered([item]) == 0
    product_key = StateStore.product_key(item.source, item.listing_id)
    assert product_key in store.products
    assert not store.is_initialized()
    assert not store.is_seen(item.key)
    assert not store.is_processed("ebay:test", item.key)
    store.mark_seen(item, sent=True)
    store.mark_processed("ebay:test", item.key)
    store.mark_initialized()
    store.close()

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["version"] == 2
    assert payload["products"][product_key]["handled"] is True
    assert payload["products"][product_key]["product_id"] == "123"
    assert payload["products"][product_key]["price"] == "25.50"
    assert payload["products"][product_key]["attributes"]["Size"] == "XL"
    assert payload["products"][product_key]["searches"] == ["Boxraw tops"]
    assert not path.with_name("listings.json.tmp").exists()

    reopened = StateStore(path)
    assert reopened.is_seen(item.key)
    assert reopened.is_processed("ebay:test", item.key)
    assert reopened.is_initialized()
    reopened.close()


def test_regional_results_share_one_product_id_record(tmp_path: Path):
    path = tmp_path / "listings.json"
    store = StateStore(path)
    french = Listing("vinted", "www.vinted.fr", "123", "Title", "https://example.test/fr")
    italian = Listing("vinted", "www.vinted.it", "123", "Title", "https://example.test/it")

    assert store.track_discovered([french, italian]) == 1
    store.close()

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert list(payload["products"]) == ["vinted:123"]
    assert payload["products"]["vinted:123"]["marketplaces"] == [
        "www.vinted.fr",
        "www.vinted.it",
    ]


def test_version_one_json_is_migrated_to_product_id_index(tmp_path: Path):
    path = tmp_path / "listings.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "items": {
                    "vinted:www.vinted.fr:123": {
                        "source": "vinted",
                        "marketplace": "www.vinted.fr",
                        "listing_id": "123",
                        "first_seen_at": "2026-07-20T10:00:00+00:00",
                        "handled": True,
                        "sent_at": "2026-07-20T10:01:00+00:00",
                    },
                    "vinted:www.vinted.it:123": {
                        "source": "vinted",
                        "marketplace": "www.vinted.it",
                        "listing_id": "123",
                        "first_seen_at": "2026-07-20T10:02:00+00:00",
                        "handled": False,
                        "sent_at": None,
                    },
                },
                "initialized_scopes": [],
                "processed_by_scope": {},
            }
        ),
        encoding="utf-8",
    )

    store = StateStore(path)
    item = Listing("vinted", "www.vinted.es", "123", "Title", "https://example.test")
    assert store.is_listing_seen(item)
    assert len(store.products) == 1
    store.close()

    payload = json.loads(path.read_text(encoding="utf-8"))
    record = payload["products"]["vinted:123"]
    assert payload["version"] == 2
    assert record["handled"] is True
    assert record["marketplaces"] == ["www.vinted.fr", "www.vinted.it"]


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
    assert store.is_initialized()
    assert json_path.exists()
    store.close()


def test_listing_key_includes_source_and_marketplace():
    first = Listing("ebay", "EBAY_GB", "123", "Title", "https://example.test/1")
    second = Listing("ebay", "EBAY_DE", "123", "Title", "https://example.test/2")
    third = Listing("vinted", "www.vinted.co.uk", "123", "Title", "https://example.test/3")
    assert len({first.key, second.key, third.key}) == 3
