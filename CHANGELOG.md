# Changelog

All notable changes to this project are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning.

## [Unreleased]

### Added

- A minimal Docker image and Compose service for continuous VPS operation.
- Clickable product source links and human-readable listing ages in Telegram.
- Configurable normalized brand validation.
- Native marketplace listing IDs in Telegram posts.
- Grouped OR keyword filters and structured marketplace attributes for size/product matching.
- Per-cycle detail caching for listings returned by overlapping searches.
- Per-cycle catalog caching for searches that differ only in local filters.
- Fresh-clone configuration checks and generic public examples.

### Changed

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
