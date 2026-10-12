# Implementation Plan

Each task is sized to 1–3 commits, following the TDD cycle in [CLAUDE.md](../CLAUDE.md): `test:` (failing) → `feat:` (pass) → `refactor:` (if needed). The full suite stays green and the work is pushed after each task.

- Setup-only tasks (1, 2) have no behaviour to test and use `chore:` / `ci:` commits.
- **Tests** lists what is written first. `T1`–`T10` are the required acceptance tests from [REQUIREMENTS §11](REQUIREMENTS.md).
- Unit tests run without a DB; integration tests use the real test DB (ARCHITECTURE §8.2).

## A. Foundations
1. [ ] **Workspace scaffold:** npm workspaces (`server`, `web`), TypeScript (`erasableSyntaxOnly`), ESLint + Prettier, Vitest, `engines: node 24.21.0`, `.env.example`.
   - Done when `npm run lint`, `npm run typecheck` and `npm test` run (empty suite).
2. [ ] **CI:** a GitHub Actions workflow with a `postgres:16` service that runs lint → typecheck → test on every push.
3. [ ] **App skeleton:** `config.ts` (zod env), pino logger with request ID, `AppError` + central error handler, `createApp(deps)`, `GET /health`.
   - Tests:
     - `/health` returns 200 and echoes `X-Request-Id`
     - an unknown route returns 404 in the error shape
     - an `AppError` maps to its status and code
     - an unknown error returns 500 `INTERNAL` with no stack
     - invalid env fails fast
4. [ ] **Database and test harness:** `pg` pool (statement timeout), `withTransaction`, node-pg-migrate, migration `0001` (`hr_users`, `countries`, `exchange_rates` + reference data and rate snapshot), test global setup and truncate helper; `/health` checks the DB.
   - Tests:
     - `/health` reports `db: ok`, and 503 when the DB check fails
     - `withTransaction` rolls back on throw
     - reference data is present after migrate

## B. Authentication and security
5. [ ] **Password hashing** (`crypto.scrypt`).
   - Unit tests:
     - hash/verify round-trip
     - a wrong password fails
     - the same password gives different hashes (salt)
     - a malformed hash is rejected
6. [ ] **Login / logout / me + `requireAuth`.**
   - Tests:
     - valid login sets an httpOnly, SameSite=Strict cookie
     - a wrong email or password gives the same generic 401
     - `/me` without a cookie → 401
     - an expired token (injected clock) → 401
     - logout clears the cookie
     - a protected route without a session → 401
7. [ ] **Security middleware:** rate limits, helmet, CORS, log redaction.
   - Tests:
     - the 6th login attempt within a minute → 429 `RATE_LIMITED`
     - API limit → 429 with `Retry-After`
     - security headers are present
     - a disallowed origin gets no CORS headers
     - a captured log line contains no cookie, body or salary

## C. Employees
8. [ ] **Money and status helpers.**
   - Unit tests:
     - amount validation (> 0, ≤ 2 decimals, no symbols)
     - annual → monthly rounding
     - `active` / `on_notice` / `exited` from dates and a fixed clock, including the boundary on the last working day itself
9. [ ] **Create employee:** migration `0002` (`employees` with checks and indexes, `employee_changes` with the immutability trigger), schemas, service, repository, `POST /api/employees`.
   - Unit tests: schema rules; the service writes a `hire` change with a full snapshot; email is lower-cased.
   - Integration tests:
     - 201 response
     - duplicate code or email → 409 `DUPLICATE`
     - invalid input → 400 with field paths
     - employee and hire change are written in one transaction
10. [ ] **List employees:** pagination, whitelisted sort, filters (country, department, job title, status), search `q`, `currency` with the converted annual salary, `ratesAsOf`.
    - Integration tests with fixtures:
      - page and total
      - sort by converted salary across currencies
      - each filter
      - search by name, code and email
      - `pageSize > 100` → 400
      - an unknown sort field → 400
11. [ ] **Get + edit profile with optimistic locking**, `GET /api/employees/filter-options`.
    - Tests:
      - GET returns `version` and `status`
      - PATCH with the current version → 200 and version + 1
      - a stale version → 409 `VERSION_CONFLICT`
      - name and email edits create no change entry
      - filter options are distinct and sorted
12. [ ] **Change events and history:** `POST` and `GET /api/employees/:id/changes`.
    - Unit tests:
      - the diff contains only changed fields
      - a no-op is rejected
      - effective date ≤ today and ≥ the latest change's date
      - note is 5–1000 characters
      - a promotion with title + salary is one event
    - Integration tests:
      - employee update and change row are atomic
      - version conflict → 409
      - history is newest first
      - the DB trigger blocks UPDATE and DELETE on `employee_changes`
13. [ ] **Lifecycle:** exit and withdraw.
    - Unit tests:
      - `hire ≤ notice ≤ last working day`
      - withdraw only while on notice
      - an exited employee only accepts `correction` changes
      - note required
    - Integration tests: endpoints write a change entry; the `status` filter in the list reflects exits.
14. [ ] **Countries and exchange rates:** `GET /api/countries`, `GET` and `PUT /api/exchange-rates/:currency`.
    - Tests:
      - PUT updates the rate, `as_of` and `updated_by`
      - INR can't be changed
      - rate ≤ 0 → 400
      - a USD → EUR conversion in the list matches the exact expected value
15. [ ] **Deterministic seed:** `npm run seed` loads 10,000 employees + hire changes + the admin user and prints the timing.
    - Tests:
      - the generator is deterministic (same seed → identical first and last rows and a checksum)
      - values are valid against the employee schema
      - an integration run with `n = 200` inserts 200 rows + 200 changes
    - Measured time goes in the README.

## D. Insights and slips
16. [ ] **Insights Q1–Q3:** summary, by-country, by-department.
    - Integration tests with a small fixture and hand-computed expected values: count, sum, avg, median, min and max in local and reporting currency; country and department filters; exited employees excluded.
17. [ ] **Insights Q4–Q5:** pay range by job title within a country; outliers.
    - Tests:
      - min, median and max per title
      - `country` is required
      - default 80% / 120% thresholds flag the expected employees
      - custom thresholds
      - pagination
18. [ ] **Insights Q6–Q7:** recent changes; leavers.
    - Tests:
      - date range and `changeType` filter
      - % salary change and old → new title
      - leavers grouped by department and country, with the total annual salary converted
19. [ ] **Slip (JSON).**
    - Unit tests on the pure calculation:
      - base ÷ 12, allowances ÷ 12, gross
      - rounding
      - employment check for the month (hire month, last working day month, before hire → error)
      - a month after the current month is rejected
    - Integration test: a slip for a past month uses the salary snapshot in effect at that month's end, not the current salary.
20. [ ] **Slip PDF:** `?format=pdf`.
    - Tests: `application/pdf`, body starts with `%PDF`, `Content-Disposition` filename includes the employee code and month.

## E. Background jobs and import
21. [ ] **Job queue and worker:** migration for `jobs`, enqueue, claim (`SKIP LOCKED`), `runOnce`, backoff, `max_attempts`, lease expiry, delayed `run_after`.
    - Integration tests (fixed clock):
      - a delayed job isn't claimed before `run_after`
      - a throwing handler is retried with backoff, then marked `failed` after 3 attempts
      - a `running` job with an expired lease is re-claimed
      - two concurrent claims never get the same job
22. [ ] **Import template + upload checks + single active import:** migration for `imports` and `import_rows`.
    - Unit tests: header match, type, size and row-count checks; required change type, date and note.
    - Integration tests:
      - the template has the header + 3 `EXAMPLE-*` rows
      - a valid upload → 202 and status `validating`
      - each failed check → 400 / 413
      - **T10:** upload while another import is active → 409 and nothing queued; accepted again after cancel
23. [ ] **Import validation job → preview.**
    - Unit tests on the row validator: field rules, example rows rejected, in-file duplicate code or email, email belonging to another employee, effective date before that employee's latest change, unchanged detection.
    - Integration tests:
      - **T1:** the mixed fixture produces exact create / update / unchanged / rejected counts
      - **T3:** the rejected-rows CSV has the original header + `error`, one line per rejected row, and re-uploads cleanly after fixing
24. [ ] **Import cancel / confirm / apply.**
    - Integration tests:
      - **T2:** cancel leaves `employees` and `employee_changes` (history + audit) unchanged
      - confirm is only allowed from `awaiting_confirmation` (else 409)
      - **T7:** an imported salary change writes history with `source = import` and the import note
      - a row invalidated between preview and apply ends up rejected
      - **T8:** a failure injected after N rows, then a retry → every row applied exactly once, one history row per changed row, earlier rows untouched
      - the raw file is cleared on completion

## F. Export
25. [ ] **Direct CSV and Excel export.**
    - Unit tests: formula-injection escaping (`= + - @ \t \r`).
    - Integration tests:
      - CSV and xlsx content types and `Content-Disposition`
      - row count and columns match the filters
      - reporting-currency column
      - an `exports` audit row is written
26. [ ] **Direct PDF export:** ≤ 1,000 rows.
    - Tests: ≤ 1,000 rows → `%PDF`; > 1,000 rows → 422 `EXPORT_TOO_LARGE`; audit row written.
27. [ ] **Emailed PDF export job.**
    - Integration tests (fake mailer):
      - `POST /exports/employees/email` → 202; the email goes to the requester's own address and contains a link and no salary data
      - **T9:** a failure after sending, then a retry → exactly 1 email; a failure before sending, then a retry → exactly 1 email
      - the file is not rebuilt on retry
      - the cleanup job is scheduled at `expires_at`
28. [ ] **Export download rules and cleanup.**
    - Integration tests:
      - the requester downloads → 200 and audited `downloaded`
      - **T4:** another HR user → 403, audited `forbidden`, no file returned
      - **T5:** clock past `expires_at` → 410, audited `expired`
      - **T6:** the cleanup job nulls the file and sets `deleted_at`, and is a no-op when run twice

## G. Frontend
29. [ ] **Web scaffold + login:** Vite, MUI theme, React Router, TanStack Query, API client (cookies, error-shape parsing), login page, auth guard.
    - RTL tests: a successful login navigates to employees; a 401 shows a generic error; protected routes redirect to login.
30. [ ] **Employees list page:** DataGrid in server mode (paging and sorting), filters, debounced search, currency selector, status chips.
    - RTL test: changing a filter or the page sends the matching query parameters.
31. [ ] **Employee detail + create/edit:** profile, current pay, history timeline, create form, profile edit with version-conflict handling.
    - RTL test: a 409 shows the "updated by someone else — reload" message.
32. [ ] **Change and exit dialogs:** change event (type, effective date, note, fields), record exit, withdraw.
    - RTL test: submit is disabled until the note is valid; the request includes `version`.
33. [ ] **Slip page:** month picker, print-friendly view, PDF download.
    - RTL test: the gross-only notice is shown, along with the earnings rows.
34. [ ] **Insights page:** Q1–Q7 with country, department and currency filters and the rates "as of" date.
    - RTL test: changing the currency re-queries with `currency`.
35. [ ] **Imports UI:** template download, upload form, status polling, preview counts, **Import valid rows / Cancel**, rejected-rows download, import history, the 409 "import in progress" message with a link.
    - RTL test: the preview shows counts and both actions call the right endpoints.
36. [ ] **Exports UI:** format menu, PDF too large → "email it to you" dialog, My exports page, the download page opened from the email link (showing 403 / 410 states).
    - RTL test: a 422 opens the email dialog and confirming posts the email export.
37. [ ] **Exchange rates page:** list and edit rates.
    - RTL test: saving sends the PUT and refreshes the "as of" date.

## H. Wrap-up
38. [ ] **README and docs pass:** setup (Node via `.nvmrc`, `.env`, create DBs, migrate), run (API + web + Mailpit), seed with measured timing, test, demo video link, links to all docs. Final check that DECISIONS and PROMPTS are up to date.
