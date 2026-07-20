from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import Listing

LOGGER = logging.getLogger(__name__)
STATE_VERSION = 1


class StateStore:
    """Atomic JSON persistence with in-memory set indexes for fast membership checks."""

    def __init__(self, path: Path, *, legacy_sqlite_path: Path | None = None) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.items: dict[str, dict[str, Any]] = {}
        self._handled: set[str] = set()
        self._initialized: set[str] = set()
        self._processed: dict[str, set[str]] = {}
        self._dirty = False

        if self.path.exists():
            self._load()
        elif legacy_sqlite_path and legacy_sqlite_path.exists():
            self._migrate_sqlite(legacy_sqlite_path)
            self.flush()

    def _load(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"State file {self.path} is unreadable; refusing to reset duplicate history"
            ) from exc
        if not isinstance(payload, dict) or payload.get("version") != STATE_VERSION:
            raise RuntimeError(f"Unsupported or invalid state file: {self.path}")

        items = payload.get("items", {})
        initialized = payload.get("initialized_scopes", [])
        processed = payload.get("processed_by_scope", {})
        if not isinstance(items, dict) or not isinstance(initialized, list):
            raise RuntimeError(f"Invalid state indexes in {self.path}")
        if not isinstance(processed, dict):
            raise RuntimeError(f"Invalid processed index in {self.path}")
        if any(not isinstance(value, dict) for value in items.values()):
            raise RuntimeError(f"Invalid item record in {self.path}")
        if any(not isinstance(keys, list) for keys in processed.values()):
            raise RuntimeError(f"Invalid processed scope in {self.path}")

        self.items = {str(key): value for key, value in items.items()}
        self._handled = {
            key for key, value in self.items.items() if bool(value.get("handled", False))
        }
        self._initialized = {str(scope) for scope in initialized}
        self._processed = {
            str(scope): {str(key) for key in keys} for scope, keys in processed.items()
        }

    @staticmethod
    def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
        row = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()
        return row is not None

    def _migrate_sqlite(self, legacy_path: Path) -> None:
        connection = sqlite3.connect(f"file:{legacy_path.resolve()}?mode=ro", uri=True)
        try:
            if self._table_exists(connection, "seen_listings"):
                rows = connection.execute(
                    """
                    SELECT listing_key, source, marketplace, listing_id, first_seen_at, sent_at
                    FROM seen_listings
                    """
                )
                for key, source, marketplace, listing_id, first_seen_at, sent_at in rows:
                    self.items[str(key)] = {
                        "source": str(source),
                        "marketplace": str(marketplace),
                        "listing_id": str(listing_id),
                        "first_seen_at": str(first_seen_at),
                        "handled": True,
                        "sent_at": sent_at,
                    }
                    self._handled.add(str(key))
            if self._table_exists(connection, "processed_listings"):
                rows = connection.execute("SELECT scope, listing_key FROM processed_listings")
                for scope, key in rows:
                    self._processed.setdefault(str(scope), set()).add(str(key))
            if self._table_exists(connection, "metadata"):
                rows = connection.execute(
                    "SELECT key FROM metadata WHERE key LIKE 'initialized:%' AND value = '1'"
                )
                self._initialized.update(str(key).removeprefix("initialized:") for (key,) in rows)
        finally:
            connection.close()
        self._dirty = True
        LOGGER.info("Imported duplicate history from %s into %s", legacy_path, self.path)

    def track_discovered(self, listings: list[Listing]) -> None:
        now = datetime.now(UTC).isoformat()
        for listing in listings:
            if listing.key in self.items:
                continue
            self.items[listing.key] = {
                "source": listing.source,
                "marketplace": listing.marketplace,
                "listing_id": listing.listing_id,
                "first_seen_at": now,
                "handled": False,
                "sent_at": None,
            }
            self._dirty = True

    def is_initialized(self, scope: str) -> bool:
        return scope in self._initialized

    def mark_initialized(self, scope: str) -> None:
        if scope not in self._initialized:
            self._initialized.add(scope)
            self._dirty = True

    def is_seen(self, key: str) -> bool:
        return key in self._handled

    def is_processed(self, scope: str, key: str) -> bool:
        return key in self._processed.get(scope, set())

    def mark_processed(self, scope: str, key: str) -> None:
        keys = self._processed.setdefault(scope, set())
        if key not in keys:
            keys.add(key)
            self._dirty = True

    def mark_seen(self, listing: Listing, *, sent: bool) -> None:
        now = datetime.now(UTC).isoformat()
        record = self.items.setdefault(
            listing.key,
            {
                "source": listing.source,
                "marketplace": listing.marketplace,
                "listing_id": listing.listing_id,
                "first_seen_at": now,
                "handled": False,
                "sent_at": None,
            },
        )
        record["handled"] = True
        if sent and not record.get("sent_at"):
            record["sent_at"] = now
        self._handled.add(listing.key)
        self._dirty = True
        # A successful Telegram send is persisted immediately to prevent restart duplicates.
        self.flush()

    def flush(self) -> None:
        if not self._dirty:
            return
        payload = {
            "version": STATE_VERSION,
            "items": dict(sorted(self.items.items())),
            "initialized_scopes": sorted(self._initialized),
            "processed_by_scope": {
                scope: sorted(keys) for scope, keys in sorted(self._processed.items())
            },
        }
        temporary_path = self.path.with_name(f"{self.path.name}.tmp")
        with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, self.path)
        self._dirty = False

    def close(self) -> None:
        self.flush()
