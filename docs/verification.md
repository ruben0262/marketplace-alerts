# Verification — 2026-10-28

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | 25 passed; real isolated MongoDB instances |
| `npm run test:python` | 7 passed; filter and adapter behavior |
| `npm run test:e2e` | 8 passed; desktop and mobile Chromium, no test retries |
| `npm run build` | Passed; initial JavaScript 105.74 kB gzip, motion/app/settings loaded separately |
| `docker compose config --quiet` | Passed |
| `git diff --check` | Passed |
| Credential scan of frontend output and application/test sources | Passed; no configured secret values found |

The browser journeys cover signup, recovery-key handling, login/logout, search creation and editing, pause/resume/delete, matching listings, Telegram settings, password recovery and changes, eBay unlock, preference persistence, and clearing a saved proxy while retaining application keys. They assert observable behavior and wait for specific outcomes; no fixed sleeps or retry-to-pass configuration is used.

The worker tests include concurrent claims, quiet first scans, cross-search deduplication, failed-send retries, deleted searches, expired leases, and edits while a scan is running. The latter caught and fixed a race in which an obsolete scan could postpone the edited search's next scan. Browser testing also caught and fixed help text being included in form control names and an early mobile navigation test interaction.

## Live profile checks

- Imported `ruben0262` into Atlas with the requested password hashed, the existing integration credentials encrypted, and a recovery key in the ignored, owner-readable `.profile-recovery-key` file.
- No `config.yaml` existed, so the importer used the BOXRAW search and filters from `config.example.yaml`.
- MongoDB login, session persistence, and logout passed.
- Telegram connection test passed, and the user confirmed receipt.
- eBay returned 2 listings; Vinted returned 90 listings during the connection checks.
- The first BOXRAW scan saved 64 matching products (62 Vinted, 2 eBay), quietly seeding the feed.
- The real profile passed read-only desktop and mobile browser checks: dashboard, migrated filters, masked credentials, and matching products.
- The final notification implementation successfully delivered one clearly labelled real product test from each marketplace to Telegram.
- Temporary plaintext import credentials were removed from `.env` after verification. Database configuration and the encryption key remain there with file mode `600`.

Preview images are local and ignored: `data/profile-desktop.png`, `data/profile-mobile.png`, `data/matches-desktop.png`, and `data/matches-mobile.png`.

## Remaining verification limit

The Docker image could not be built on this machine: the current account has no access to `/var/run/docker.sock`, and `sudo -n` requires interactive authentication. Compose syntax passed, but container build/start/health checks are **not verified**. Run `sudo docker compose up -d --build` in an authenticated terminal, then inspect `sudo docker compose ps` and the service logs. See the main README for origin, HTTPS, and reverse-proxy configuration.

The app was implemented and tested locally for Docker hosting; it has not been published to an external hosting service. No temporary browser/test servers were left running.

# Update — 2026-10-29

## Current checks

- `npm run build` succeeds; the missing theme stylesheet that interrupted the earlier build is fixed.
- `npm test`: 46 passing behavior tests against isolated MongoDB instances. An additional run of the concurrent overlapping-search regression also passes.
- `npm run test:python`: 7 passing adapter/filter tests.
- Desktop/mobile browser journeys: 14 passing in one clean run, with zero retries. Coverage includes email signup and verification, recovery and password changes, eBay access, private multi-bot routing, account isolation, notification read persistence, and saved theme/browser preferences.
- Landing visual checks at 320, 360, 390, 768 and 1440 pixels: readable type, no horizontal overflow, local photography, light/dark themes, working process controls and reduced-motion behavior.
- Dark Connections checked on desktop and mobile without browser runtime errors or failed requests.
- Real-profile browser checks passed on desktop and mobile using the email login: saved searches, masked credentials, Connections, preferences, notifications and latest finds.
- Configured secret values were checked against the compiled JS/CSS/HTML: none were present.
- Compose validation and `git diff --check` pass. Docker image execution is still unverified because this OS account cannot access the Docker daemon socket.

## Live account and integrations

The existing `ruben0262` account now has `lekliruben@gmail.com`. Its password and imported encrypted marketplace settings were preserved. The legacy Telegram connection became a private account-owned destination; the saved search retains that route. The original 72 saved matches were checked against the new notification collection: none were replayed as new notifications.

Zoho EU SMTP settings were copied from the user's authorized `lead_gen` project into the ignored, mode-600 `.env`. A required-STARTTLS connection and SMTP authentication check passed. Zoho accepted the account verification message. Email ownership remains unverified until the recipient opens that link and confirms it; the test did not bypass verification or enable email alerts without that step.

Live worker logs show successful Vinted and eBay scans and successful Telegram deliveries with the migrated profile. Worker scans were briefly paused during the history migration check, then restored to enabled. No historical notification cleanup was necessary.

## Operational logging

MongoDB connection/ping/index readiness appears before server readiness. API request metadata, scans and delivery results are written to stdout and owner-readable rotating files under `data/logs/`, persisted by Docker's data volume. Tests verify rotation, retention, log levels and exclusion of secrets/provider messages. Logs omit email addresses, reset tokens, request bodies and connection strings. See [operations](operations.md).

The development watcher remains the user's existing server; temporary verification servers are shut down by their test harnesses. The full application visual redesign remains pending the user's review of the revised landing page. Functional navigation, accessibility/readability and theme changes are implemented now.

# Update — 2026-10-30

## Changes and regression coverage

- Reproduced the reported verification failure through the development server: the same request from `127.0.0.1:5173` returned 403 while the configured `localhost:5173` origin passed request verification. Vite's string-form proxy changed `Host`. The proxy now preserves the browser host, with the API's cross-site and custom-header checks unchanged.
- Added an integration test using the real Vite proxy and isolated MongoDB. It creates notifications through a search/worker scan, marks all read, checks the persisted feed, saves a theme, logs in again to confirm persistence, and confirms cross-site/missing-header writes are still rejected.
- Browser regressions exercise the account menu, keyboard dismissal/focus, theme persistence without success notices, inline save failure/retry, bulk-read failure/retry and reload persistence. Permission scenarios include granted, denied, dismissed, thrown errors, and a request reporting granted while the browser remains blocked.
- Browser notification tests control the browser/OS APIs at their external boundary. This avoids depending on the host notification tray. Native headless Chromium on this machine reports `Notification.permission` as denied even when its permission query/request reports granted; actual OS notification display is therefore not verified by this suite.
- Appearance, Notifications, Search preferences and Account are separate settings cards. The workspace uses stronger warm surfaces, a dark sidebar, distinct page headers, colored section accents, clear filters and unread states.
- The icon-only account menu replaces the email/preferences block; the sidebar tagline is removed. The Scout logo and favicon share the same radar artwork. Official-source integration logos are local SVGs; see [asset provenance](brand-assets.md).

## Responsive review

An isolated fixture account was checked on Overview, Settings, New search, each of the three Connections tabs, and Notifications, in both themes at 320, 768 and 1440 pixels: **42 combinations**, with no horizontal overflow, broken image assets or browser runtime errors. Screenshots were inspected for the settings sections, account menu, notifications, connections, find cards and search builder. SVGs were parsed successfully, and `git diff --check` passed.

These checks use temporary databases and deterministic provider boundaries. No real email or Telegram messages were sent and no production account notification states were changed. Live marketplace availability, OS notification delivery and Docker deployment were not revalidated in this update.

## Final results

| Check | Result |
| --- | --- |
| `npm test` | 47 passed |
| `npm run test:python` | 7 passed |
| `npm run test:e2e` | 32 passed in one final run; desktop/mobile Chromium; zero retries |
| `npm run build` | Passed |
| Responsive/asset/runtime sweep | 42 page/theme/viewport combinations passed |
| SVG validation and `git diff --check` | Passed |

Temporary verification servers and databases were closed after the checks. Changes remain in the local checkout; this update was not deployed.

# Update — 2026-10-31

## Final requested changes

- The account icon and displayed name share a single clickable container. Its menu contains the quiet light/dark control, Settings and Log out.
- Shared app and landing palettes now use strong orange, white and charcoal. The final computed-color review found no green UI accents; official brand artwork retains its original colors. Settings cards, unread notifications, filters and page sections remain visually separated.
- Every native select reserves 46 px for text clearance and places its 18 px arrow 15 px from the edge. Settings and Telegram disclosure controls also have consistently spaced, rotating arrows. These remain native keyboard-accessible controls.
- Added public and signed-in support pages. The fixed recipient is `hello@flow-solutions.xyz`, the sender is the configured Zoho EU `no-reply@flow-solutions.xyz`, and Reply-To is the customer's address. A persisted queue retries temporary SMTP failures independently of marketplace scans. Automated tests use a fake mailbox; no real support test ticket was sent.
- Docker has separate public-origin, secure-cookie and proxy settings for `https://scout.rubenlekli.com`, preserving local HTTP development. Added `npm run check:deployment` and Cloudflare Tunnel/server instructions in the README.
- The landing page is loaded separately. Removed 16,736 bytes of obsolete CSS. The initial JS bundle is 316.73 kB / 103.14 kB gzip; initial CSS is 38.82 kB / 8.99 kB gzip. Hashed assets cache for a year, HTML and bootstrap/service-worker JS revalidate, and static responses are compressed. API responses stay `no-store`.

## Verification results

| Check | Result |
| --- | --- |
| `npm test` | **54 passed**, isolated real MongoDB instances |
| `npm run test:python` | **7 passed** |
| `npm run test:e2e` | **36 passed**, desktop/mobile Chromium, zero retries |
| Final production build | Passed |
| Final visual/layout review | **78 combinations**: 13 pages, 2 themes, widths 320/768/1440; disclosure controls opened |
| Final layout findings | No horizontal overflow, broken images, JS runtime errors or remaining green UI colors; 24 visible select instances checked |
| `npm run check:deployment` | Real MongoDB access/index readiness and Zoho EU TLS/authentication passed; no messages sent by this command |
| `docker compose config --quiet` | Passed |
| `npm audit --omit=dev` | Zero known production dependency vulnerabilities reported |
| Configured-secret scan | No configured secret values found in 74 application, test and build text files; `.env` remains mode 600 |
| `git diff --check` | Passed |
| Existing development app | API, actual Vite proxy, support page and favicon return HTTP 200 |

New behavior tests cover a complete forgot-password email journey, new-password login, rejection of the old password and consumed link, support submission/retry after a lost response, fixed-recipient delivery, Reply-To, validation/rate limits, worker restarts and competing workers, static compression/cache behavior, and HTTPS tunnel cookies/canonical email URLs. Existing regressions still cover mark-all-read through the real Vite proxy, theme persistence and inline failure recovery, notification permission outcomes, search lifecycle, and email verification. The final styling/disclosure refinements were rebuilt and reviewed through all 78 combinations after the browser suite; they do not change API behavior.

Final screenshots and review data are ignored local artifacts under `data/qa/`, including `final-account-menu-dark-mobile.png`, `final-settings-dark-mobile.png`, and `final-review.json`. Temporary test services and browsers were closed; the user's existing development servers were left running.

## Real email and deployment limits

One authorized password-reset email was sent through the actual `/api/auth/forgot` handler to `lekliruben@gmail.com`. Zoho accepted the recipient with no SMTP rejection. Its link uses `https://scout.rubenlekli.com/reset-password`; no password was changed. The user confirmed receipt in their inbox on 2026-10-31, verifying delivery through Zoho EU to the recipient inbox. The link expires after 15 minutes, so request a fresh link after the public tunnel is online.

Docker build/start/health remains **unverified**: the current OS account receives permission denied from `/var/run/docker.sock`. The public Cloudflare Tunnel is to be created by the user, so public HTTPS access and an actual public-domain reset journey remain pending. Headless browser tests cannot verify display in the operating system notification tray; the permission/application behavior is covered at that external boundary. Verification was performed locally before publication; no server deployment was performed in this pass.

The last mobile-menu review removed the tinted backdrop and corrected the skip link's dark-mode contrast. Keyboard testing also found that the skip link scrolled without transferring focus; all four page shells now make the main region programmatically focusable. The landing regression and account-menu journey passed again on desktop and mobile (**4 targeted tests, zero retries**). Separate keyboard checks passed on landing, login, public support and the app in both themes (**8 combinations**); the menu overlay is neutral charcoal in both modes. The final build and whitespace check pass after these refinements.
