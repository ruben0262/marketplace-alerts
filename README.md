# Scout · Marketplace Alerts

A mobile-first React app for finding products on Vinted and eBay, with a Node.js API, MongoDB accounts and per-user settings, and in-app notifications with optional email and private Telegram destinations. The existing Python marketplace adapters do the actual searches.

- Landing page with Framer Motion transitions and reduced-motion support.
- Email sign-up, email-or-username login, password changes, email verification, and recovery by email, one-time key or a verified private Telegram destination.
- Overview, visual search builder, editable/pausable searches, matching listings, notifications, Connections tabs, and account preferences.
- Vinted enabled for new accounts; eBay available only after each user adds their own production keys.
- MongoDB stores accounts, sessions, encrypted credentials, settings, searches, matching products, and delivery history.
- Quiet first scans, per-destination cross-search deduplication, expiring worker leases, marketplace cooldowns, and retryable Telegram/email delivery.
- Light/dark themes, browser notification preferences, and a mobile landing page with local photography and accessible process animations.

## Run locally

Requires Node.js 22.12+ (24 recommended), Python 3.11+, and MongoDB/Atlas.

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -e .
# For a fresh checkout only; do not overwrite an existing .env:
cp .env.example .env
```

Set `MONGODB_URI`, `MONGODB_DB`, and `ENCRYPTION_KEY` in `.env`. Generate the encryption key once:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The URI can include credentials directly or use `<db_username>` / `<db_password>` placeholders with `MONGODB_USERNAME` and `MONGODB_PASSWORD`. Atlas must allow the server's IP and the database user must be able to read/write and create indexes. Keep a backup of the encryption key alongside your database backup; replacing it makes existing integration credentials unreadable.

```bash
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to Node on port 3000. Set `APP_URL=http://localhost:5173` for Vite development. The Vite proxy preserves the browser’s host, so `localhost` and `127.0.0.1` both work. The API accepts requests from the browser’s actual same origin and this configured Vite origin; cross-site writes remain rejected. `APP_URL` also sets the origin used in email/recovery links. The worker runs with the API. Set `WORKER_ENABLED=false` for UI-only work.

For a compiled local application:

```bash
npm run build
APP_URL=http://localhost:3000 npm start
```

## Docker / hosting

```bash
docker compose up -d --build
docker compose logs -f marketplace-alerts
```

The image builds React and bundles Node plus Python. Atlas remains external; MongoDB data does not depend on the container. The named `scout-data` volume retains Vinted session cookies and rotating operational logs. Containers run without root privileges and have a database-backed healthcheck. The service binds to **127.0.0.1:3000** by default.

Startup logs confirm MongoDB connection and ping before server readiness. API, scans and deliveries produce structured JSON logs in the terminal and `data/logs/scout.jsonl`, with bounded rotation and no credentials or request bodies. See [operations and logging](docs/operations.md) for commands, retention and environment settings.

Behind a reverse proxy, set:

```dotenv
DOCKER_APP_URL=https://scout.rubenlekli.com
DOCKER_COOKIE_SECURE=true
DOCKER_TRUST_PROXY=true
```

Use `DOCKER_TRUST_PROXY=true` only with one trusted reverse proxy; otherwise leave it false. These Docker settings override the local `COOKIE_SECURE` and `TRUST_PROXY` values, so development can continue over HTTP. Set `BIND_ADDRESS` deliberately if the reverse proxy cannot reach the loopback binding. `APP_PORT` selects the host port. Point the proxy at the app and terminate HTTPS there. `DOCKER_APP_URL` must match the browser's real origin so recovery links and CSRF checks work.

For this installation, create the Cloudflare Tunnel hostname **scout.rubenlekli.com**, pointing to **http://127.0.0.1:3000** when cloudflared runs on the same host. Keep the app port bound to loopback. If cloudflared runs in a separate container, use a shared private Docker network and the service's internal port instead; its own `127.0.0.1` will not reach Scout. Keep the public URL HTTPS and the origin HTTP.

Copy the ignored `.env` securely to the server; Git does not contain the database password, encryption key, or SMTP password. Preserve the existing encryption key. Before starting the service:

```bash
docker compose config --quiet
docker compose build
docker compose run --rm marketplace-alerts npm run check:deployment
docker compose up -d
docker compose ps
```

The deployment check verifies public-origin settings, MongoDB access/indexes, and SMTP TLS/authentication without sending mail. After the tunnel is online, open the public site and check signup, login and a fresh reset link. The container restarts unless explicitly stopped; enable Docker and cloudflared at server boot. A Docker healthcheck reports failures but does not itself restart an unhealthy running process.

The background worker claims one search at a time and limits delivery bursts. Database leases permit multiple processes without concurrent work on one search. Scale modestly: Vinted and eBay impose their own rate limits, and each active search/region adds requests. Poll intervals are targets, not guarantees; slow searches can delay others. The default is two minutes, with a fifteen-minute cooldown after a marketplace failure. Search subprocesses have a two-minute hard timeout per source.

## Import an existing profile

Normal startup never seeds an account, imports global credentials, or resets a password. To migrate explicitly, add temporary `IMPORT_USERNAME` and `IMPORT_PASSWORD` entries to the ignored `.env`, then:

```bash
npm run import:profile
```

The importer reads `config.yaml`, or `config.example.yaml` if no personal YAML exists. It migrates the Telegram/eBay credentials, both proxies, DeepL key, user agent, search filters, supported regions and scan preferences. Credentials are encrypted with AES-256-GCM. The password is hashed with scrypt. The one-time account recovery key is written to `.profile-recovery-key` with owner-only permissions. Save it privately. Remove `IMPORT_PASSWORD` after testing. An existing username is left unchanged on subsequent imports.

New users sign up with an email address and receive their own blank configuration and a recovery key. Existing imported usernames still work in the “Email or username” login field; add an email later under Account & preferences. No user inherits imported environment credentials. Prices use each marketplace region's currency without conversion; select one region when a fixed-currency budget matters.

## Connections and per-search alerts

Open **Connections** in the app navigation. Its Vinted, eBay and Telegram tabs keep marketplace credentials separate from account preferences:

- **Vinted:** enabled by default. Select regions and optionally configure a proxy, then test the connection.
- **eBay:** add your own production App ID and Cert ID, select regions, and test. Both keys are required before a search can use eBay.
- **Telegram:** add named destinations with a bot token and numeric chat ID. Open `@BotFather` to create a bot, start a chat with it, then save and test the destination. Several destinations can use different bots or chats. Credentials remain private to the account and are never returned to the browser; editing shows blank replacement fields.

In each search, choose zero, one or several Telegram destinations. New searches enable **In-app notifications** by default; **Email alerts** are optional and require a verified email plus configured SMTP. Leaving Telegram unchecked does not prevent matching listings from appearing in the app. Routes apply to future finds; changing destinations does not replay old matches. Deleting a destination removes it from searches and cancels its pending deliveries. Imported single-bot accounts migrate automatically to a named destination without copying credentials to other users.

Telegram notifications include a product image when available, a caption and listing button; rejected images fall back to text. Delivery is tracked separately for each destination, so a failed bot does not block the others.

## Account, appearance and browser preferences

Open the **account icon** at the bottom of the sidebar for the dark-mode toggle, **Settings**, and **Log out**. Settings separates appearance, notifications, search preferences and account security into individual cards. Themes persist on the device and sync with the signed-in account without a popup. If saving fails, an inline message offers a retry.

The **Notifications** page keeps new matches and unread state in your account. Browser alerts additionally require the account’s **Allow browser alerts** preference and permission from that browser. Use **Enable browser notifications** to grant permission. These are browser notifications while Scout is open, not background push after the app closes; some mobile browsers do not support them. Email and Telegram can deliver while you are away.

Turning off **Send Telegram and email alerts** pauses external delivery while the feed and enabled in-app notifications continue. A quiet first scan fills Latest finds without alerting by default. Choose **Include existing matches in my first alerts** on a search to change that behavior.

## Email and recovery

Set these values in the ignored `.env` to enable email verification, password-reset links and optional product alerts:

```dotenv
SMTP_HOST=smtp.zoho.eu
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@flow-solutions.xyz
SMTP_PASSWORD=your-smtp-password
MAIL_FROM=no-reply@flow-solutions.xyz
```

Use your provider’s authenticated SMTP account and an allowed sender address. Port 587 requires STARTTLS; for implicit TLS, usually port 465, set `SMTP_SECURE=true`. `APP_URL` must point to the app’s reachable browser URL, and Docker’s public origin is `DOCKER_APP_URL`. Restart the app after changing environment values. Without SMTP, account sign-up, existing username login, in-app alerts and Telegram still work; email delivery remains unavailable.

Email sign-up sends a verification link when SMTP is configured. In Account & preferences, an existing user can add or change their email by confirming the current password, or request another verification link. Verification links expire after 24 hours and are used once. Changing the email clears verification and cancels pending alerts for the previous address.

Forgot-password accepts an email or existing username and gives a generic response regardless of account existence. Reset links go to the account email when email delivery is available; otherwise a configured, verified **private** Telegram recovery destination can be used. Select that destination in Connections → Telegram. Groups/channels may receive product alerts but cannot receive password-reset links. A saved recovery key also works without SMTP or Telegram.

Reset links expire after 15 minutes and work once. Recovery keys work once and rotate on recovery/password changes. Password recovery invalidates previous sessions. Save the new recovery key shown after a reset or password change.

## Tests

```bash
npm test
npm run test:python
npm run build
npx playwright install chromium  # first browser installation only
npm run test:e2e
```

The Node tests use a real, temporary MongoDB instance (`mongodb-memory-server`), not a mocked repository. Its first run downloads a MongoDB binary into `/tmp/scout-mongodb-binaries` (override `MONGOMS_DOWNLOAD_DIR` if desired). Tests require permission to open local ports. Browser journeys run the compiled app on port 3100 against their own temporary database; marketplace, Telegram, email and browser/OS notification edges use deterministic fixtures. They cover desktop and mobile email sign-up, search lifecycle, private Telegram routing, matches, Connections, notification preferences, email verification, recovery and password changes with user-facing selectors and observable outcomes. The regression checks also cover bulk notification reads, failed requests and retries, account-menu keyboard behavior, silent theme persistence, and denied/dismissed notification permission. A real Vite-proxy integration test exercises account writes while confirming cross-site requests are rejected. No arbitrary sleeps or retry-to-pass settings are used.

Live checks are optional and never run as part of the automated suite. Put temporary `CHECK_LOGIN` (email or username) and `CHECK_PASSWORD` values in the ignored `.env`, then remove them when finished. Existing `IMPORT_USERNAME` / `IMPORT_PASSWORD` values remain supported as a fallback.

```bash
npm run check:live
# Login and real Vinted/eBay connection checks; no test-message sends.

npm run check:live -- --send-tests
# Also sends ONE REAL Telegram test to EACH saved destination.

npm run check:live -- --scan-and-queue
# Also scans one eligible active search. This can queue real email/Telegram
# product alerts, which an already-running worker may deliver immediately.

npm run check:live -- --send-tests --scan-and-queue
# Explicitly perform both actions above.

npm run check:live -- --browser-only
# Inspect the compiled app using the real account, on desktop and mobile.
```

Browser checks require a current `npm run build` and installed Playwright Chromium. They start a temporary loopback API without a worker, check email-or-username login, existing searches, masked credentials in Connections, private recovery choices, account preferences, notifications and matching listings. They do not save settings/search changes or send tests. Login/logout, rate limits and idempotent account migrations still touch the real database. Preview screenshots contain private account content and are stored under ignored `data/` with owner-only permissions. The scripts log only status/count summaries, never returned account objects, destination names, credentials or raw provider errors.

Never point ordinary automated tests at your production database. External delivery is at-least-once: if a message succeeds remotely but its acknowledgement/database update is lost, a retry can duplicate it. Routine rescans and concurrent workers deduplicate deliveries per product and destination.

## Source map

| Location | Purpose |
| --- | --- |
| `src/` | React pages, mobile layouts, lazy motion and reusable UI |
| `server/app.js` | Validated HTTP API, cookie sessions, CSRF protection and rate limiting |
| `server/worker.js` | Search scheduling, MongoDB leases and notification retries |
| `server/integrations.js` | Bounded Python bridge and Telegram transport |
| `server/mailer.js` | SMTP delivery, verification/reset emails and product alert formatting |
| `server/logger.js` | Allowlisted operational events, stdout and bounded rotating files |
| `server/telegram-bots.js` | Private bot migration, credential storage and public masked status |
| `listing_monitor/bridge.py` | Per-user adapter/filter/translation execution |
| `scripts/` | Explicit profile import and live validation |
| `tests/` | Account, isolation, worker, import, adapter and browser behavior tests |
| `docs/legacy-monitor.md` | Historical standalone Python CLI reference |

The Python CLI still works independently, but its file-based history is separate from the web application's MongoDB records. Stop an old single-user monitor before enabling the same searches in the web app, to avoid two independent alert streams. Existing legacy JSON listing history is not automatically imported.

The visual direction was informed by [MotionSites](https://motionsites.ai/) and the FlowSolutions references. Photography and the local font are credited in [docs/landing-assets.md](docs/landing-assets.md); demo listings are illustrative. Motion respects the device setting through [MotionConfig](https://motion.dev/docs/react-motion-config). A shared MongoClient uses the driver's [connection pool](https://www.mongodb.com/docs/drivers/node/current/connect/mongoclient/).

## Support and delivery

`/support` is available before login, with another entry in the app navigation. Messages go only to **hello@flow-solutions.xyz**, from **no-reply@flow-solutions.xyz**, with the customer's email as Reply-To. The confirmation includes a ticket reference and means the request is saved for delivery.

Tickets are persisted in MongoDB, delivered by a separate worker loop, and retried with backoff after SMTP failures. Retries of the same browser submission reuse the ticket; simultaneous workers use a delivery lease. As with SMTP generally, a connection loss after remote acceptance can cause a duplicate on retry; a stable Message-ID helps receivers identify it. Tickets expire from the app database after 90 days; mailbox retention is separate. Keep `WORKER_ENABLED=true` on the server. Request validation, same-origin protection and per-IP/per-email limits apply to the public form. If SMTP is unconfigured, the form gives the direct support email instead of claiming success.

HTML and the service worker revalidate on each load, hashed assets cache for a year, and Express compresses static text responses. Authenticated APIs remain `no-store`. Landing, app, settings, support and motion code load separately; fonts, logos and photos are served locally.
