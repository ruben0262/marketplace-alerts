# Marketplace Alerts

A small Python app that checks eBay and Vinted for new marketplace listings and sends matching items to a Telegram channel.

It supports:

- configurable search terms, sizes, product types, prices, and listing age
- multiple eBay marketplaces and Vinted regional sites
- Telegram posts containing images, description, price, clickable product link, listing age, and ID
- JSON tracking with fast in-memory indexes so listings are not processed or posted twice
- built-in English condition labels and optional full listing translation through DeepL
- eBay's official Browse API and a best-effort Vinted integration

## Project structure

```text
listing_monitor/       Application code
  marketplaces/        eBay and Vinted integrations
tests/                 Automated tests
.env.example           Credential template
config.example.yaml    Search configuration template
Dockerfile             Container image definition
compose.yaml           VPS container and persistent state
.dockerignore          Files excluded from Docker builds
README.md              Setup and usage
CHANGELOG.md            Version history
pyproject.toml          Python package and dependencies
```

Your real `.env`, `config.yaml`, databases, caches, and build files are ignored by Git.

## Install

Python 3.11 or newer is required.

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e .
Copy-Item .env.example .env
Copy-Item config.example.yaml config.yaml
```

macOS or Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
cp .env.example .env
cp config.example.yaml config.yaml
```

## Configure

Edit `.env` and add your credentials:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
DEEPL_API_KEY=
```

Create the Telegram bot through `@BotFather`, add it to your channel as an administrator, and use either the channel username such as `@my_channel` or its numeric chat ID.

Edit `config.yaml` to choose:

- search phrases and marketplaces
- required or excluded keywords
- size and product keyword groups
- maximum listing age and optional price limits
- polling interval and number of pages

The example configuration starts with eBay disabled. After adding eBay credentials, change `sources.ebay.enabled` to `true`.

## Run with Docker on a VPS

Docker Compose runs one continuous Marketplace Alerts container. No ports or additional services are required.

Create your private files first:

```bash
cp .env.example .env
cp config.example.yaml config.yaml
```

Fill in `.env` and edit `config.yaml`, then validate them inside the container:

```bash
docker compose run --rm marketplace-alerts \
  python -m listing_monitor --check-config --config /app/config.yaml
```

Run one dry scan before enabling notifications:

```bash
docker compose run --rm marketplace-alerts \
  python -m listing_monitor --once --dry-run --config /app/config.yaml
```

Start the monitor in the background:

```bash
docker compose up -d --build
```

View logs and container status:

```bash
docker compose logs -f marketplace-alerts
docker compose ps
```

Restart or stop it:

```bash
docker compose restart marketplace-alerts
docker compose down
```

The `restart: unless-stopped` policy restarts the monitor after a crash or VPS reboot. Listing state is stored as `data/listings.json` in the `marketplace-alerts-data` Docker volume and survives container rebuilds and `docker compose down`.

Do not use `docker compose down -v` unless you intentionally want to delete the seen-listing history. Losing that volume resets duplicate protection.

Run only one container for a given configuration and state file. Scaling the service into replicas can cause duplicate Telegram notifications. If you need separate monitors, use separate Compose projects, configurations, and volumes.

## Run

Check the configuration without contacting any service:

```powershell
python -m listing_monitor --check-config
```

Preview one scan without posting to Telegram or saving listing state:

```powershell
python -m listing_monitor --once --dry-run
```

Run one real scan:

```powershell
python -m listing_monitor --once
```

Run continuously:

```powershell
python -m listing_monitor
```

Stop continuous mode with `Ctrl+C`. Use `python -m listing_monitor --help` to see every option.

## Duplicate protection

Each listing is identified by its source, marketplace, and native listing ID. That compound ID is included in its Telegram post and used as the key in `data/listings.json`.

The JSON file is durable storage, while Python dictionaries and sets are built from it at startup for average O(1) ID checks. The monitor records every listing returned by a marketplace, not only matches. Successful Telegram sends are persisted immediately, and other state changes are saved after each search using an atomic file replacement. A failed send is deliberately left eligible for retry.

Marketplace result pages must be checked again to discover new IDs, but previously handled listings are not fetched in detail or posted again. Searches with identical marketplace parameters also share one response during a polling cycle.

When `send_existing_on_start` is `false`, the first successful scan records existing matches without flooding Telegram. Only later listings are posted.

If an older `data/listings.sqlite3` database exists and the JSON file does not, its duplicate and initialization history is imported automatically on first startup. Keep both files and the Docker volume intact until that first migrated run completes.

## English translation

Common Vinted condition labels in French, German, Spanish, Italian, and Dutch are translated locally without an account or network request. Unknown conditions, titles, descriptions, and colours can optionally be translated with DeepL:

1. Add `DEEPL_API_KEY` to the private `.env` file.
2. Set `translation.enabled: true` in `config.yaml`.
3. Use the Free API URL from the example configuration for a DeepL API Free key, or change it to `https://api.deepl.com/v2/translate` for a Pro API key.
4. Restart the monitor.

The service auto-detects the source language, requests British English by default, caches repeated text in memory, and keeps the original text if translation is unavailable. Enabling it sends the listing title, description, condition, and colour text to DeepL, so review its privacy and usage terms before use. Brand, size, seller name, IDs, prices, and links are kept unchanged. See the [DeepL translation API documentation](https://developers.deepl.com/api-reference/translate/request-translation).

## Search filters

Each search in `config.yaml` supports:

- `query`: marketplace search text
- `sources`: `ebay`, `vinted`, or both
- `max_age_hours`: maximum listing age, or `null` to disable
- `min_price` and `max_price`: optional price range
- `required_brands`: accepted brands, normalized for case, spaces, and punctuation
- `excluded_sizes`: exact size labels to reject, using structured size data when available
- `include_keywords`: every phrase must match
- `include_any_groups`: one phrase from every group must match
- `exclude_keywords`: any matching phrase rejects the listing
- source-specific category IDs

Filtering checks the title, description, and available attributes such as brand, size, and colour.
When `required_brands` is set, a structured marketplace brand must match one configured value exactly after normalization. If a marketplace provides no brand attribute, matching falls back to the normalized title and description.

`excluded_sizes` uses complete labels rather than substring matching, so excluding `s` does not
reject words such as `shorts` or possessives such as `men's`. Add marketplace aliases such as
`xs`, `x-small`, `extra small`, `s`, and `small` when all those forms should be rejected.

Marketplace searches and Telegram delivery are ordered newest-first. Increase `pages_per_search` to backfill older results; adapters stop early when a page is not full. Use `max_age_hours: null` if old listings should remain eligible. Setting `send_existing_on_start: true` sends matching backfill results the first time a search runs, so use it carefully.

## Telegram delivery rate

Telegram recommends avoiding more than one message per second to one chat. The monitor spaces
delivery using `telegram.min_send_interval_seconds` (default `1.1`) and honors Telegram's
server-provided `retry_after` delay after HTTP 429 responses. A rate-limited photo is not retried
immediately as a text message, because that would consume the same limit again. Listings that still
cannot be delivered remain unseen and are eligible for retry during a later scan.

## Important Vinted note

Vinted does not provide an official public marketplace-search API. The Vinted adapter uses the website's catalog and item-detail endpoints and may stop working if Vinted changes them. It refreshes anonymous sessions when needed and does not attempt to bypass CAPTCHAs, access controls, or rate limits. An eBay or Vinted failure does not stop the other configured searches.

The adapter uses browser-compatible anonymous sessions and stores cookies under
`data/vinted-cookies`. If a Vinted site rejects a VPS address, that site is paused for
`retry_cooldown_seconds` instead of being retried for every configured search.

Some hosting-provider IP ranges are rejected by Vinted even when the same URL works from a home
browser. If that happens, use a trusted HTTP proxy that you are authorized to use by adding this
only to the private `.env` file:

```dotenv
VINTED_PROXY=http://user:password@host:port
```

The `http://` prefix is optional; both forms are accepted. Never commit the proxy credentials.
Restart the container after changing `.env`. A proxy is optional; leave the value empty first and
try the browser-compatible session update on its own. This project does not solve or bypass a
CAPTCHA. The official
[Vinted Pro Integrations API](https://pro-docs.svc.vinted.com/) manages a Pro seller's own inventory
and webhooks; it does not provide public catalog discovery for this monitor.

Use a sticky residential proxy session when possible. If the proxy changes its exit IP between the
cookie refresh and catalog/detail request, Vinted may reject the session. When item-detail access
fails, the monitor pauses detail lookups for that site and continues posting the catalog title,
price, image, brand, size, and link. Set `fetch_item_details: false` to disable descriptions and
extra-image lookups completely while keeping catalog alerts.

Anonymous catalog access is sufficient for fresh listing discovery. Account login is intentionally
not implemented because it adds account and credential risk and is unnecessary while catalog scans
continue succeeding.

To check only Vinted connectivity without posting or changing deduplication state:

```powershell
docker compose run --rm marketplace-alerts python -m listing_monitor --once --dry-run
```

## Development

```powershell
python -m pip install -e ".[dev]"
python -m pytest -q
python -m ruff check .
```

## Repository safety

Never commit `.env`, `config.yaml`, state files, databases, or credentials. Before pushing, check staged files with:

```powershell
git status --short
git diff --cached
```

Revoke a credential immediately if it is exposed.

The application suppresses `httpx` request logs and redacts Telegram tokens and URL-embedded proxy
credentials from formatted logs. Logs should still be handled as potentially sensitive.

## License

MIT. See [LICENSE](LICENSE).
