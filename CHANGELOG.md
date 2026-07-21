# Changelog

All notable changes to this project are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning.

## [Unreleased]

### Added

- Per-search delivery diagnostics showing sent, silently seeded, already handled/checked,
  rejected, and failed Telegram counts, plus a startup summary of enabled sources.
- Host-visible `./data` bind mount for persistent, directly searchable VPS JSON state, plus
  complete observed listing metadata in each product-ID record.
- Product-ID-first JSON state schema with automatic version-1 migration and one durable record
  per source/native ID, regardless of regional domain, URL, title, or search.
- Vinted Spain, Italy, the Netherlands, Belgium, and Portugal in the public and private configs.
- Case/space/punctuation-insensitive size filtering with localized marketplace field names,
  plus native-ID deduplication across regional domains of the same source.
- Deterministic search fingerprints so initialization state remains stable across restarts.
- Atomic JSON listing history with in-memory set/dictionary indexes for fast duplicate checks,
  including every discovered item and automatic migration from the former SQLite database.
- Offline English translations for common European condition labels and optional DeepL
  translation for titles, descriptions, colours, and unknown conditions.
- Product condition in Telegram alerts and configurable exact-size exclusions.
- Telegram delivery pacing and support for server-provided `retry_after` delays.
- Credential redaction for Telegram request URLs and URL-embedded proxy authentication.
- Browser-compatible Vinted sessions, persistent anonymous cookies, optional proxy support,
  and per-site failure cooldowns for VPS deployments.
- Current Vinted item-detail lookups, replacing the obsolete endpoint that returned HTTP 404.
- A minimal Docker image and Compose service for continuous VPS operation.
- Clickable product source links and human-readable listing ages in Telegram.
- Configurable normalized brand validation.
- Native marketplace listing IDs in Telegram posts.
- Grouped OR keyword filters and structured marketplace attributes for size/product matching.
- Per-cycle detail caching for listings returned by overlapping searches.
- Per-cycle catalog caching for searches that differ only in local filters.
- Fresh-clone configuration checks and generic public examples.

### Changed

- Telegram rate limits no longer trigger an immediate photo-to-text fallback.
- Vinted item-detail failures now enter a per-site cooldown while catalog alerts continue.
- Noisy `httpx` INFO request logs are suppressed so Telegram bot tokens are not printed.
- Expected marketplace outages now produce one concise warning per cycle instead of a traceback
  for every configured search.
- Marketplace results are processed newest-first, with deeper backfill controlled by page settings.
- Renamed the public project and command to Marketplace Alerts.
- Simplified the repository and consolidated usage guidance into the README.

## [0.1.0] - 2026-07-20

### Added

- Configurable eBay Browse API searches across multiple marketplaces.
- Best-effort Vinted searches across multiple regional sites.
- Telegram text, photo, and multi-image album publishing.
- Price, age, include-keyword, exclude-keyword, and source-specific category filters.
- SQLite listing deduplication and safe initial-run seeding.
- Per-search initialization and processing state to prevent recovery floods.
- Bounded retries, polling jitter, per-search error isolation, dry-run mode, and one-shot mode.
- Git-safe `.env.example` and `config.example.yaml` templates.
- Unit tests and project documentation.
