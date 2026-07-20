# Marketplace Alerts

A small Python app that checks eBay and Vinted for new marketplace listings and sends matching items to a Telegram channel.

It supports:

- configurable search terms, sizes, product types, prices, and listing age
- multiple eBay marketplaces and Vinted regional sites
- Telegram posts containing images, description, price, clickable product link, listing age, and ID
- SQLite tracking so the same listing is not processed or posted twice
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

The `restart: unless-stopped` policy restarts the monitor after a crash or VPS reboot. SQLite state is stored in the `marketplace-alerts-data` Docker volume and survives container rebuilds and `docker compose down`.

Do not use `docker compose down -v` unless you intentionally want to delete the seen-listing history. Losing that volume resets duplicate protection.

Run only one container for a given configuration and state database. Scaling the service into replicas can cause duplicate Telegram notifications. If you need separate monitors, use separate Compose projects, configurations, and volumes.

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

Each listing is identified by its source, marketplace, and native listing ID. That ID is included in its Telegram post and recorded in the local SQLite database.

Marketplace result pages must be checked again to discover new IDs, but previously processed listings are not fetched in detail or posted again. Searches with identical marketplace parameters also share one response during a polling cycle.

When `send_existing_on_start` is `false`, the first successful scan records existing matches without flooding Telegram. Only later listings are posted.

## Search filters

Each search in `config.yaml` supports:

- `query`: marketplace search text
- `sources`: `ebay`, `vinted`, or both
- `max_age_hours`: maximum listing age, or `null` to disable
- `min_price` and `max_price`: optional price range
- `required_brands`: accepted brands, normalized for case, spaces, and punctuation
- `include_keywords`: every phrase must match
- `include_any_groups`: one phrase from every group must match
- `exclude_keywords`: any matching phrase rejects the listing
- source-specific category IDs

Filtering checks the title, description, and available attributes such as brand, size, and colour.
When `required_brands` is set, a structured marketplace brand must match one configured value exactly after normalization. If a marketplace provides no brand attribute, matching falls back to the normalized title and description.

Marketplace searches and Telegram delivery are ordered newest-first. Increase `pages_per_search` to backfill older results; adapters stop early when a page is not full. Use `max_age_hours: null` if old listings should remain eligible. Setting `send_existing_on_start: true` sends matching backfill results the first time a search runs, so use it carefully.

## Important Vinted note

Vinted does not provide an official public marketplace-search API. The Vinted adapter uses the website's catalog and item-detail endpoints and may stop working if Vinted changes them. It uses bounded retries and does not attempt to bypass CAPTCHAs, access controls, or rate limits. An eBay or Vinted failure does not stop the other configured searches.

## Development

```powershell
python -m pip install -e ".[dev]"
python -m pytest -q
python -m ruff check .
```

## Repository safety

Never commit `.env`, `config.yaml`, databases, or credentials. Before pushing, check staged files with:

```powershell
git status --short
git diff --cached
```

Revoke a credential immediately if it is exposed.

## License

MIT. See [LICENSE](LICENSE).
