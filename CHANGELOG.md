# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **readers**: add the Mercedes-Benz reader client (`MERCEDES_READER_BASE_URL`) with cancel, resume and model discovery.
- **extractions**: request Mercedes-Benz extractions by series and model designation, one extraction per model.
- **transformer**: generate the Mercedes-Benz Excel report when the last model completes, follow it in the history, download it as `{axCode}.xlsx` and retry it when it fails.
- **db**: add the `report_*` columns to `extraction_requests` (migration `0018_mercedes_reports`).

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
