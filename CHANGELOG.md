# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.0] - 2026-11-25

### ⚠ Breaking Changes

- **config**: the web no longer reads `RENAULT_READER_DOWNLOAD_ORIGIN`, `TRANSFORMER_DOWNLOAD_ORIGINS`, `BMW_READER_LANGUAGE`, `RENAULT_READER_LANGUAGE` or `ORACLE_EXCLUDED_GROUP_IDS`. The S3 address and the language belong to each reader and transformer.

### Added

- **readers**: add the Mercedes-Benz reader client (`MERCEDES_READER_BASE_URL`) with cancel, resume and model discovery.
- **extractions**: request Mercedes-Benz extractions by series and model designation, one extraction per model.
- **transformer**: generate the Mercedes-Benz Excel report when the last model completes, follow it in the history, download it as `{axCode}.xlsx` and retry it when it fails.
- **transformer**: use the shared transformer API v1 through a registry-driven client and register the Mercedes-Benz transformer in the infrastructure page.
- **db**: add the `report_*` columns to `extraction_requests` (migration `0018_mercedes_reports`).
- **auth**: make sessions revocable. Users can be disabled, the user sync disables accounts that are no longer active in TimerTask, and the session now lasts 2 hours and renews itself (migration `0019_revocable_sessions`).
- **readers**: cap reader usage per user (120 requests per minute) and cache the Renault family lists.
- **history**: show requests as compact rows with search by AX code and a status filter, and load them in pages of 20 requests (migration `0040_request_pagination_indexes`).
- **history**: use the browser's native popover for the row actions and the account menu, with visible download and resume buttons.
- **ui**: replace `window.confirm` with a native dialog that states the consequence of each action.
- **ui**: add design tokens for color, type and focus, shared `Button`, `Badge`, `Alert` and `ProgressBar` components, and a serif face for page titles.
- **ui**: add a dark theme. It follows the system by default and each user can choose system, light or dark from the account menu; the choice is kept in a cookie.

### Changed

- **readers**: accept the signed download link of a reader or transformer when it is HTTPS (plain HTTP only on loopback or a Docker service name), carries no credentials and is not a private or metadata address, instead of comparing it with configured origins.
- **readers**: stop sending a language to BMW and Renault. Each reader answers with its own `API_LANGUAGE`; a request that does name one still sends it.
- **employees**: read the Oracle group and line ids in one module.
- **ui**: flatten shadows, reduce corner radii and use one focus style across the interface.
- **ui**: improve the copy, links and flow of the approvals, login and error pages, and clarify error messages.
- **ui**: harden the empty, error and loading states of the history, approvals and administration pages.
- **a11y**: associate field errors with their inputs, move the focus to the first invalid field and fix the findings of the accessibility audit.
- **auth**: resolve the user identity and role in parallel.
- **layout**: stream the dashboard header behind Suspense.
- **proxy**: run the proxy only on page requests.
- **extractions**: lazy-load the Mercedes-Benz selector and the BMW swap review in the stepper form.
- **db**: add indexes for the loaded-table lookup and the reconciliation queries, and replace a redundant extraction index.
- **ui**: defer the search filtering of the long selectors and animate the progress bar with a transform.

### Fixed

- **api**: validate the request origin on state-changing route handlers.
- **api**: enforce the upload size limit while streaming and validate the signature of uploaded ZIP and LST files.
- **db**: connect without TLS to any Docker service name (for example `request-extraction-db`), not only to `postgres`.
- **transformer**: refuse report downloads from credentials, plain remote HTTP and private or metadata addresses.
- **logging**: stop logging full error objects.
- **db**: set statement and idle-in-transaction timeouts on the pool, use a 64-bit advisory lock key, protect the audit logs from cascade deletion (migration `0032`), tolerate a missing `DATABASE_URL` when generating and normalize fallback emails.
- **layout**: keep the footer at the bottom of the viewport.
- **history**: render the progress fill under the production content security policy.
- **proxy**: style the Next.js development overlay.
- **login**: remove the show-password toggle.
- **extractions**: show the AX code placeholder in normal case.

### Upgrade notes

- Apply the new migrations before deploying: `0019`, `0030` to `0033` and `0040`. The code already reads the columns they add.
- Every user has to sign in again, because earlier session tokens are rejected.
- Remove `RENAULT_READER_DOWNLOAD_ORIGIN`, `TRANSFORMER_DOWNLOAD_ORIGINS`, `BMW_READER_LANGUAGE`, `RENAULT_READER_LANGUAGE` and `ORACLE_EXCLUDED_GROUP_IDS` from the environment; they are ignored. Set `API_LANGUAGE` on each reader instead.
- Deploy renault-reader 1.1.0 or later first: it answers a labour request without a language with its `API_LANGUAGE`, where 1.0.0 rejects it. bmw-reader 1.1.0 still works (it defaults to `en-GB`); 2.0.0 renames its variable to `API_LANGUAGE`.
- Dependabot, a weekly dependency audit and a container health check were added; the web port is now bound to `127.0.0.1` in `docker-compose.yml`.
- `db:generate` is disabled because `db/migrations/meta` has no snapshots; write migrations by hand and apply them with `drizzle-kit migrate`.

## [1.0.0] - 2026-11-17

### Added

- **extractions**: show extraction requests as accordions, grouped by request, with an aggregate status and pulsing progress bars.
- **extractions**: repeat failed or cancelled items, and repeat a whole request from the history.
- **extractions**: show the shared request data in the approvals page.
- **extractions**: validate the AX code as 3 to 4 alphanumeric characters, always in uppercase.
- **extractions**: check BMW typekey availability before leaving the models step, block unavailable typekeys and suggest reliable base types.
- **extractions**: show the reader's not-available message for rejected typekeys and the base type in the typekey options.
- **extractions**: redesign the request form as a stepper and the request header of the history.
- **extractions**: ask for confirmation before replacing a table that is already loaded.
- **extractions**: load each typekey with the date of its own extraction.
- **transformer**: load the extracted data into BMW_Labour as soon as the last typekey completes, and show the load in the history.
- **transformer**: let technicians compare an LST file against the loaded data and download the Excel result, with uploads up to 25 MB.
- **transformer**: start pending loads from the history and retry failed ones at once.
- **mail**: email the requester when a load completes and the support team when something fails.
- **admin**: show the optional Renault and VAG services on the infrastructure page.
- **auth**: let an HTTP-only deployment opt out of Secure session cookies.
- **db**: create the users of the test accounts when the database is set up.
- **config**: accept plain HTTP towards Docker service names.

### Fixed

- **extractions**: keep progress monotonic and ignore stale status updates.
- **extractions**: log reader ZIP failures and report extractions the reader cannot find.
- **extractions**: recover abandoned submissions and retry temporary reader failures.
- **transformer**: refresh load and comparison state while the history is open.
- **transformer**: claim every load start, give up after repeated failures and keep reconciliation independent.
- **transformer**: do not blame support for network errors.
- **mail**: notify on every final transition and retry failed or abandoned notices.

### Changed

- **db**: move the shared extraction fields to `extraction_requests`.

[Unreleased]: https://github.com/pablo-solera/request-extraction-web/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/pablo-solera/request-extraction-web/releases/tag/v1.0.0
