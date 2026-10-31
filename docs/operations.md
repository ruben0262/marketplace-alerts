# Running Scout

Build the frontend with `npm run build`, then start the app with `npm start` and open `http://localhost:3000`. During development, `npm run dev` runs the API and Vite together; use the Vite URL printed in that terminal. Rebuild after frontend changes when using `npm start`.

## Terminal and stored logs

Scout writes one JSON event per line to stdout, so the same events appear in the local terminal and Docker logs. Startup reports `mongodb.connecting`, `mongodb.connected` after a successful ping, and `mongodb.indexes_ready` before the web server and worker become ready. A failed connection reports its error type and startup exits unsuccessfully.

API events include a generated request ID, HTTP method, route template, response status and elapsed milliseconds. Scans report their marketplace, matching item count and elapsed time. Deliveries report their channel, result and retry attempt. Provider error messages, request bodies, credentials, cookies, email addresses, reset links and MongoDB connection strings are excluded from logs.

```sh
# Local logs
tail -f data/logs/scout.jsonl

# Docker terminal logs
docker compose logs --follow --tail=100 marketplace-alerts

# Read the current persisted file inside the container
docker compose exec marketplace-alerts tail -n 100 /app/data/logs/scout.jsonl
```

The file logger keeps `scout.jsonl` plus four rotated backups, each up to 10 MiB, in `LOG_DIR` (default `data/logs`). Directories are owner-only and files use mode `600`. Docker retains this directory in the `scout-data` volume across container replacement. Docker's own stdout log rotation separately retains three 10 MB files. `LOG_LEVEL=warn` or `error` reduces routine output; the default is `info`.

Files include internal account and search IDs for troubleshooting. Treat them as private operational data. File write failures are reported to stdout, and terminal logging continues.

## Email

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` in the ignored `.env`. Port 587 uses required STARTTLS. Set `SMTP_SECURE=true` for implicit TLS, usually on port 465. Certificate verification remains enabled.

`APP_URL` must be the public origin users can open; verification and reset links use this origin. For Docker set `DOCKER_APP_URL` to the production HTTPS origin. When serving behind a trusted reverse proxy, set `TRUST_PROXY=true` and `COOKIE_SECURE=true`; restrict direct access to the container's port.

Signup sends email verification and provides a recovery key. Accounts can log in before verification, but email delivery for searches requires a verified address. Telegram destinations and in-app notifications work independently. Changing an email address requires the current password and a new verification.

Browser notifications are enabled in account preferences by default, but require the user to grant browser permission. They run while Scout is open; use Telegram or email for alerts when it is closed. In-app notifications remain in the private notification feed.

## Docker

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

The image runs as a non-root user, stores app data in its named volume and waits for in-flight scans during shutdown. The health check pings MongoDB through `/api/health`; successful health probes do not fill the request logs.

Back up the MongoDB database and `ENCRYPTION_KEY` together. The encryption key is required to recover saved Telegram and marketplace credentials. Secrets must never use a `VITE_` prefix or enter the frontend bundle.


## Cloudflare Tunnel deployment and mail

The production origin is `https://scout.rubenlekli.com`; the same-host tunnel origin is `http://127.0.0.1:3000`. The checked-in `.env.example` includes `DOCKER_APP_URL`, `DOCKER_COOKIE_SECURE=true` and `DOCKER_TRUST_PROXY=true`. Compose uses these independently of the local-development values. Supply the private database, encryption and SMTP credentials in the server's `.env`.

Run `npm run check:deployment` locally or `docker compose run --rm marketplace-alerts npm run check:deployment` after building. It sends no messages: it checks origin/cookies/proxy/worker configuration, MongoDB access and indexes, and Zoho EU TLS/authentication. It does not test DNS, Cloudflare or inbox placement; check those through the public site once the tunnel is active.

Support requests queue in `supportTickets` and deliver to `hello@flow-solutions.xyz` using the same Zoho sender as verification and password resets. The worker must remain enabled. `support.sent` and `support.delivery_failed` logs report outcomes without email addresses or message contents. Failures retry from one minute up to one hour apart. Pending messages survive app restarts. Documents expire after 90 days. Monitor delivery failures and the age of pending tickets; the health endpoint checks MongoDB, not email delivery.

Verification and reset email failures log `email.verification_failed` and `email.recovery_failed`. The forgot-password response stays generic to avoid revealing whether an account exists. Reset links expire after 15 minutes, verification links after 24 hours; request a new link when testing after deployment.
