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
STATE_VERSION = 2


class StateStore:
    """Product-ID-first JSON persistence with O(1) in-memory indexes."""

    def __init__(self, path: Path, *, legacy_sqlite_path: Path | None = None) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.products: dict[str, dict[str, Any]] = {}
        self._handled_products: set[str] = set()
        # One-time, app-wide seed flag. Once the first run has silently absorbed the
        # pre-existing backlog, every later match is reported, even after filters change.
        self._initialized: bool = False
        self._processed: dict[str, set[str]] = {}
        self._dirty = False

        if self.path.exists():
            self._load()
            # Persist a version-1 migration before any marketplace request is attempted.
            self.flush()
        elif legacy_sqlite_path and legacy_sqlite_path.exists():
            self._migrate_sqlite(legacy_sqlite_path)
            self.flush()
        LOGGER.info(
            "Product state ready at %s: %d tracked IDs, %d handled IDs",
            self.path,
            len(self.products),
            len(self._handled_products),
        )

    @staticmethod
    def product_key(source: str, listing_id: str) -> str:
        """Namespace a native product ID by source, never by regional domain."""
        return f"{source.strip().casefold()}:{listing_id.strip().casefold()}"

    def _load(self) -> None:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                f"State file {self.path} is unreadable; refusing to reset duplicate history"
            ) from exc
        if not isinstance(payload, dict) or payload.get("version") not in {1, STATE_VERSION}:
            raise RuntimeError(f"Unsupported or invalid state file: {self.path}")

        processed = payload.get("processed_by_scope", {})
        if not isinstance(processed, dict):
            raise RuntimeError(f"Invalid state indexes in {self.path}")
        if any(not isinstance(keys, list) for keys in processed.values()):
            raise RuntimeError(f"Invalid processed scope in {self.path}")
        self._processed = {
            str(scope): {str(key) for key in keys} for scope, keys in processed.items()
        }
        # Prefer the global flag; fall back to any prior per-scope init or stored
        # products so upgrading an existing state file never replays the backlog.
        initialized_flag = payload.get("initialized")
        if initialized_flag is None:
            initialized_flag = bool(
                payload.get("initialized_scopes")
                or payload.get("products")
                or payload.get("items")
            )
        self._initialized = bool(initialized_flag)

        if payload["version"] == 1:
            items = payload.get("items", {})
            if not isinstance(items, dict) or any(
                not isinstance(value, dict) for value in items.values()
            ):
                raise RuntimeError(f"Invalid version-1 item records in {self.path}")
            for record in items.values():
                self._merge_product(
                    source=str(record.get("source", "")),
                    listing_id=str(record.get("listing_id", "")),
                    marketplace=str(record.get("marketplace", "")),
                    first_seen_at=str(record.get("first_seen_at", "")),
                    handled=bool(record.get("handled", False)),
                    sent_at=record.get("sent_at"),
                )
            self._dirty = True
            LOGGER.info(
                "Upgraded product history in %s to state version %d", self.path, STATE_VERSION
            )
        else:
            products = payload.get("products", {})
            if not isinstance(products, dict) or any(
                not isinstance(value, dict) for value in products.values()
            ):
                raise RuntimeError(f"Invalid product records in {self.path}")
            self.products = {str(key): value for key, value in products.items()}

        self._handled_products = {
            key for key, value in self.products.items() if bool(value.get("handled", False))
        }

    def _merge_product(
        self,
        *,
        source: str,
        listing_id: str,
        marketplace: str,
        first_seen_at: str,
        handled: bool,
        sent_at: Any,
    ) -> bool:
        if not source or not listing_id:
            return False
        key = self.product_key(source, listing_id)
        now = datetime.now(UTC).isoformat()
        record = self.products.get(key)
        changed = False
        if record is None:
            record = {
                "source": source,
                "product_id": listing_id,
                "first_seen_at": first_seen_at or now,
                "handled": handled,
                "sent_at": sent_at,
                "marketplaces": [marketplace] if marketplace else [],
            }
            self.products[key] = record
            changed = True
        else:
            current_first_seen = str(record.get("first_seen_at", ""))
            if first_seen_at and (not current_first_seen or first_seen_at < current_first_seen):
                record["first_seen_at"] = first_seen_at
                changed = True
            if handled and not bool(record.get("handled", False)):
                record["handled"] = True
                changed = True
            if not record.get("sent_at") and sent_at:
                record["sent_at"] = sent_at
                changed = True
            marketplaces = record.setdefault("marketplaces", [])
            if marketplace and marketplace not in marketplaces:
                marketplaces.append(marketplace)
                changed = True
        if bool(record.get("handled", False)):
            self._handled_products.add(key)
        return changed

    @staticmethod
    def _update_product_snapshot(
        record: dict[str, Any], listing: Listing, observed_at: str
    ) -> bool:
        """Keep the richest searchable metadata observed for one product ID."""
        changed = False
        values: dict[str, Any] = {
            "title": listing.title,
            "url": listing.url,
            "price": str(listing.price) if listing.price is not None else None,
            "currency": listing.currency,
            "description": listing.description,
            "image_urls": listing.image_urls,
            "listed_at": listing.created_at.isoformat() if listing.created_at else None,
            "seller": listing.seller,
        }
        for name, value in values.items():
            if value in (None, "", []):
                continue
            if record.get(name) != value:
                record[name] = value
                changed = True

        if listing.attributes:
            attributes = record.setdefault("attributes", {})
            for name, value in listing.attributes.items():
                if value and attributes.get(name) != value:
                    attributes[name] = value
                    changed = True
        if listing.search_name:
            searches = record.setdefault("searches", [])
            if listing.search_name not in searches:
                searches.append(listing.search_name)
                changed = True
        if record.get("last_seen_at") != observed_at:
            record["last_seen_at"] = observed_at
            changed = True
        return changed

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
                    SELECT source, marketplace, listing_id, first_seen_at, sent_at
                    FROM seen_listings
                    """
                )
                for source, marketplace, listing_id, first_seen_at, sent_at in rows:
                    self._merge_product(
                        source=str(source),
                        listing_id=str(listing_id),
                        marketplace=str(marketplace),
                        first_seen_at=str(first_seen_at),
                        handled=True,
                        sent_at=sent_at,
                    )
            if self._table_exists(connection, "processed_listings"):
                rows = connection.execute("SELECT scope, listing_key FROM processed_listings")
                for scope, key in rows:
                    self._processed.setdefault(str(scope), set()).add(str(key))
            if self._table_exists(connection, "metadata"):
                row = connection.execute(
                    "SELECT 1 FROM metadata WHERE key LIKE 'initialized:%' AND value = '1' LIMIT 1"
                ).fetchone()
                if row is not None:
                    self._initialized = True
        finally:
            connection.close()
        self._dirty = True
        LOGGER.info("Imported duplicate history from %s into %s", legacy_path, self.path)

    def track_discovered(self, listings: list[Listing]) -> int:
        now = datetime.now(UTC).isoformat()
        new_product_count = 0
        for listing in listings:
            key = self.product_key(listing.source, listing.listing_id)
            if key not in self.products:
                new_product_count += 1
            changed = self._merge_product(
                source=listing.source,
                listing_id=listing.listing_id,
                marketplace=listing.marketplace,
                first_seen_at=now,
                handled=False,
                sent_at=None,
            )
            record = self.products[key]
            changed = self._update_product_snapshot(record, listing, now) or changed
            if changed:
                self._dirty = True
        return new_product_count

    def is_initialized(self) -> bool:
        return self._initialized

    def mark_initialized(self) -> None:
        if not self._initialized:
            self._initialized = True
            self._dirty = True

    def is_seen(self, key: str) -> bool:
        """Backward-compatible check for either a product key or old compound listing key."""
        if key in self._handled_products:
            return True
        parts = key.split(":", 2)
        return len(parts) == 3 and self.product_key(parts[0], parts[2]) in self._handled_products

    def is_listing_seen(self, listing: Listing) -> bool:
        return self.product_key(listing.source, listing.listing_id) in self._handled_products

    def is_processed(self, scope: str, key: str) -> bool:
        return key in self._processed.get(scope, set())

    def mark_processed(self, scope: str, key: str) -> None:
        keys = self._processed.setdefault(scope, set())
        if key not in keys:
            keys.add(key)
            self._dirty = True

    def mark_seen(self, listing: Listing, *, sent: bool) -> None:
        now = datetime.now(UTC).isoformat()
        self._merge_product(
            source=listing.source,
            listing_id=listing.listing_id,
            marketplace=listing.marketplace,
            first_seen_at=now,
            handled=True,
            sent_at=now if sent else None,
        )
        record = self.products[self.product_key(listing.source, listing.listing_id)]
        self._update_product_snapshot(record, listing, now)
        record["handled"] = True
        if sent and not record.get("sent_at"):
            record["sent_at"] = now
        self._handled_products.add(self.product_key(listing.source, listing.listing_id))
        self._dirty = True
        # Persist an acknowledged Telegram send before another listing can be processed.
        self.flush()

    def flush(self) -> None:
        if not self._dirty:
            return
        products = {}
        for key, value in sorted(self.products.items()):
            record = dict(value)
            record["marketplaces"] = sorted({str(item) for item in record.get("marketplaces", [])})
            products[key] = record
        payload = {
            "version": STATE_VERSION,
            "products": products,
            "initialized": self._initialized,
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
