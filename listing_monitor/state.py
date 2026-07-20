from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .models import Listing


class StateStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path)
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS seen_listings (
                listing_key TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                marketplace TEXT NOT NULL,
                listing_id TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                sent_at TEXT
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_listings (
                scope TEXT NOT NULL,
                listing_key TEXT NOT NULL,
                processed_at TEXT NOT NULL,
                PRIMARY KEY (scope, listing_key)
            )
            """
        )
        self.connection.commit()

    def is_initialized(self, scope: str) -> bool:
        row = self.connection.execute(
            "SELECT value FROM metadata WHERE key = ?", (f"initialized:{scope}",)
        ).fetchone()
        return row is not None and row[0] == "1"

    def mark_initialized(self, scope: str) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, '1')",
            (f"initialized:{scope}",),
        )
        self.connection.commit()

    def is_seen(self, key: str) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM seen_listings WHERE listing_key = ?", (key,)
        ).fetchone()
        return row is not None

    def is_processed(self, scope: str, key: str) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM processed_listings WHERE scope = ? AND listing_key = ?",
            (scope, key),
        ).fetchone()
        return row is not None

    def mark_processed(self, scope: str, key: str) -> None:
        self.connection.execute(
            """
            INSERT OR IGNORE INTO processed_listings(scope, listing_key, processed_at)
            VALUES (?, ?, ?)
            """,
            (scope, key, datetime.now(UTC).isoformat()),
        )
        self.connection.commit()

    def mark_seen(self, listing: Listing, *, sent: bool) -> None:
        now = datetime.now(UTC).isoformat()
        self.connection.execute(
            """
            INSERT INTO seen_listings
                (listing_key, source, marketplace, listing_id, first_seen_at, sent_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(listing_key) DO UPDATE SET
                sent_at = COALESCE(seen_listings.sent_at, excluded.sent_at)
            """,
            (
                listing.key,
                listing.source,
                listing.marketplace,
                listing.listing_id,
                now,
                now if sent else None,
            ),
        )
        self.connection.commit()

    def close(self) -> None:
        self.connection.close()
