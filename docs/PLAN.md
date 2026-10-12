# Implementation Plan

The plan is built in **vertical slices**: each slice delivers an API and the UI that uses it, so the app is usable after every slice. The job queue, import and email export come last; import is there because it runs on the queue.

Each task is sized to 1–3 commits, following the TDD cycle in [CLAUDE.md](../CLAUDE.md): `test:` (failing) → `feat:` (pass) → `refactor:` (if needed). The full suite stays green and the work is pushed after each task.

- Setup-only tasks (1, 2) have no behaviour to test and use `chore:` / `ci:` commits.
- **Tests** lists what is written first. `T1`–`T18` are the required acceptance tests from [REQUIREMENTS §11](REQUIREMENTS.md).
- Unit tests need no DB; integration tests use the real test DB; web tests use React Testing Library with `fetch` mocked (ARCHITECTURE §8.2).

## Slice A: Foundations
1. [x] **Workspace scaffold:** npm workspaces (`server`; `web` joins in Task 8 when it has content), ESLint + Prettier, Vitest, `engines: node 24.21.0`, `.env.example`.
   - `tsconfig` sets `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit` and `strict`.
   - Done when `npm run lint`, `npm run typecheck` and `npm test` run, and `node server/src/main.ts` starts.
2. [x] **CI:** a GitHub Actions workflow with a `postgres:16` service that runs lint → typecheck → test on every push.
   - First run was blocked by a GitHub account billing lock; after it was cleared, the re-run passed (lint, typecheck, test, Postgres service up).
3. [x] **App skeleton:** `config.ts` (zod env), pino logger with request ID, `AppError` + central error handler, `createApp(deps)`, `GET /health`.
   - Tests:
     - `/health` returns 200 and echoes `X-Request-Id`
     - an unknown route returns 404 in the error shape
     - an `AppError` maps to its status and code
     - an unknown error returns 500 `INTERNAL` with no stack
     - invalid env fails fast
4. [x] **Database and test harness:** `pg` pool (statement timeout, DB session in UTC, `DATE` returned as string), `withTransaction`, node-pg-migrate, migration `0001` (`hr_users`, `countries`, `exchange_rates`, `exchange_rate_changes` + reference data and rate snapshot), test global setup and truncate helper; `/health` checks the DB.
   - Tests:
     - `/health` reports `db: ok`, and 503 when the DB check fails
     - `withTransaction` rolls back on throw
     - reference data is present after migrate
     - a `DATE` round-trips as the identical `YYYY-MM-DD` string while the suite runs with `TZ=America/Los_Angeles`, set in the Vitest config (**T17**, DB part)

## Slice B: Log in
5. [x] **Password hashing** (`crypto.scrypt`).
   - Unit tests:
     - hash/verify round-trip
     - a wrong password fails
     - the same password gives different hashes (salt)
     - a malformed hash is rejected
6. [x] **Login / logout / me API + `requireAuth` with revocation, and the user CLI** (`npm run user:create` / `user:disable -- <email>`).
   - Tests:
     - valid login sets an httpOnly, SameSite=Strict cookie
     - a wrong email or password gives the same generic 401
     - `/me` without a cookie → 401
     - an expired token (injected clock) → 401
     - logout clears the cookie
     - a protected route without a session → 401
     - **T16:** after `disable`, the existing cookie → 401 on the next request and login fails with the generic message; after logout, replaying the old token → 401 (`token_version` changed)
     - follow-up: `user:reset-password` (new password, sessions end, same user ID) and `user:enable`; `COOKIE_SECURE=false` omits `Secure`; unknown / wrong / disabled logins each run exactly one hash check and throw the identical error
7. [x] **Security middleware:** rate limits, helmet, CORS, log redaction.
   - Tests:
     - the 6th login attempt for the same email from one IP within a minute → 429 `RATE_LIMITED`
     - the 21st login attempt from one IP within a minute, each with a **different** email → 429 (per-IP limit)
     - API limit → 429 with `Retry-After`
     - security headers are present
     - a disallowed origin gets no CORS headers
     - a captured log line contains no cookie, body or salary
8. [x] **Web scaffold + login page:** Vite, MUI theme, React Router, TanStack Query, API client (cookies, error-shape parsing), auth guard, `?next=` return.
   - RTL tests:
     - a successful login navigates to `next`, or to `/employees` by default
     - a 401 shows a generic error
     - a protected route redirects to `/login?next=…`
     - an absolute or `//` `next` is ignored, so it can't be used as an open redirect

   ✅ *Usable: HR can log in.*

## Slice C: Employee list
9. [x] **Money and status helpers.**
   - Unit tests:
     - amount validation (> 0, ≤ 2 decimals, no symbols)
     - annual → monthly rounding
     - `active` / `on_notice` / `exited` from dates and a fixed clock, including the boundary on the last working day itself
     - **T17:** `today()` with `APP_TIMEZONE=Asia/Kolkata` at `2026-03-31T19:00:00Z` → `2026-04-01`
10. [x] **Create employee API:** migration `0002` (`employees` with checks and indexes, `employee_changes` with the immutability trigger), schemas, service, repository, `POST /api/employees`.
    - Unit tests: schema rules; the service writes a `hire` change with a full snapshot (including country and currency); email is lower-cased.
    - Integration tests:
      - 201 response
      - duplicate code or email → 409 `DUPLICATE`
      - invalid input → 400 with field paths
      - employee and hire change are written in one transaction
11. [x] **List employees API:** pagination, whitelisted sort, filters (country, department, job title, status), search `q`, `currency` with the converted annual salary, `ratesAsOf`.
    - Integration tests with fixtures:
      - page and total
      - sort by converted salary across currencies
      - each filter
      - search by name, code and email
      - `pageSize > 100` → 400
      - an unknown sort field → 400
12. [x] **Deterministic seed:** `npm run seed` loads 10,000 employees + hire changes + the admin user and prints the timing.
    - Tests:
      - the generator is deterministic (same seed → identical first and last rows and a checksum)
      - values are valid against the employee schema
      - an integration run with `n = 200` inserts 200 rows + 200 changes
    - Measured time goes in the README.
13. [x] **Employees list page:** DataGrid in server mode (paging and sorting), filters, debounced search, currency selector, status chips.
    - RTL test: changing a filter, the sort or the page sends the matching query parameters.
    - Also done here (the page needs them): `GET /api/employees/filter-options` (moved from Task 14), and a 401 on any query sends the user to login with `?next=`.
    - Measured on the seeded 10k database: list queries 13–59 ms.

    ✅ *Usable: HR can browse, search and filter all 10,000 employees in any currency.*

## Slice D: Employee detail, create and edit
14. [x] **Get + edit profile API with optimistic locking.**
    - Tests:
      - GET returns `version` and `status`
      - PATCH with the current version → 200 and version + 1
      - a stale version → 409 `VERSION_CONFLICT`
      - PATCH can't change country, salary, title or department (400)
      - name and email edits create no change entry
15. [x] **Detail page + create and edit pages:** profile, current pay, create form, profile edit.
    - RTL tests: create posts the form and navigates to the new employee; a 409 shows the "updated by someone else — reload" message.
    - Done as: `/employees/new` page; profile edit as a dialog on the detail page; list rows open the detail page; server field errors shown on their inputs.

    ✅ *Usable: HR can add employees and fix profile details.*

## Slice E: Pay and title changes (including relocation)
16. [ ] **Change events and history API:** `POST` and `GET /api/employees/:id/changes`, including `relocation`.
    - Unit tests:
      - the diff contains only changed fields
      - a no-op is rejected
      - effective date ≤ today and ≥ the latest change's date
      - note is 5–1000 characters
      - a promotion with title + salary is one event
      - **relocation:** `countryCode` is only allowed with `relocation`; relocation requires `baseSalary` and `allowances`; the snapshot takes the new country's currency
      - **hire date correction:** `hireDate` is only allowed with `correction`; it must be ≤ the first non-hire change's date and ≤ the notice date
    - Integration tests:
      - employee update and change row are atomic
      - version conflict → 409
      - history is newest first
      - the DB trigger blocks UPDATE and DELETE on `employee_changes`
      - a relocation writes one change with the old → new country and salary (**T14**, API part)
17. [ ] **Change dialog + history timeline UI:** change type, effective date, note and fields. Choosing *relocation* shows the country field and makes the salary fields required, labelled in the new currency.
    - RTL tests: submit is disabled until the note is valid; relocation without a salary can't be submitted; the request includes `version`.

    ✅ *Usable: HR records raises, promotions and relocations with notes, and sees the history.*

## Slice F: Resignation and exit
18. [ ] **Exit and withdraw API.**
    - Unit tests:
      - `hire ≤ notice ≤ last working day`
      - withdraw only while on notice
      - an exited employee only accepts `correction` changes
      - note required
    - Integration tests: endpoints write a change entry; the `status` filter in the list reflects exits.
19. [ ] **Exit and withdraw dialogs:** status and last working day on the detail page, plus the status filter in the list.
    - RTL test: the exit dialog validates date order and shows the computed notice days.

    ✅ *Usable: HR tracks resignations and notice periods.*

## Slice G: Exchange rates
20. [ ] **Countries and exchange-rates API with rate history:** `GET /api/countries`, `GET` and `PUT /api/exchange-rates/:currency`, `GET /api/exchange-rates/history`.
    - Tests:
      - PUT updates the rate, `as_of` and `updated_by`, and writes an `exchange_rate_changes` row (old → new, who, when) in the same transaction
      - the rate history is append-only (trigger)
      - INR can't be changed
      - rate ≤ 0 → 400
      - a USD → EUR conversion in the list matches the exact expected value
21. [ ] **Exchange rates page:** list, edit, history.
    - RTL test: saving sends the PUT and refreshes the rate, its "as of" date and the history.

    ✅ *Usable: HR keeps rates current, with an audit trail.*

## Slice H: Pay insights
22. [ ] **Insights API Q1–Q3:** summary, by-country, by-department.
    - Integration tests with a small fixture and hand-computed expected values: count, sum, avg, median, min and max in local and reporting currency; country and department filters; exited employees excluded.
23. [ ] **Insights API Q4–Q5:** pay range by job title within a country; outliers.
    - Tests:
      - min, median and max per title
      - `country` is required
      - default 80% / 120% thresholds flag the expected employees
      - custom thresholds
      - pagination
24. [ ] **Insights API Q6–Q7:** recent changes; leavers.
    - Tests:
      - date range and `changeType` filter
      - % salary change and old → new title
      - relocations shown with old → new country
      - leavers grouped by department and country, with the total annual salary converted
25. [ ] **Insights page:** Q1–Q7 with country, department and currency filters and the rates "as of" date.
    - RTL test: changing the currency re-queries with `currency`.

    ✅ *Usable: HR answers the seven pay questions.*

## Slice I: Salary slips
26. [ ] **Slip API (JSON).**
    - Unit tests on the pure calculation:
      - base ÷ 12, allowances ÷ 12, gross
      - rounding
      - employment check for the month (hire month, last working day month, before hire → error)
      - a month after the current month is rejected
    - Integration tests:
      - a past-month slip uses the snapshot in effect at month end, not the current salary
      - after a hire date is corrected to an earlier date, a slip for a month between the new hire date and the first snapshot uses the earliest snapshot
      - a slip for a month before a relocation uses the **old currency and country** (**T14**, slip part)
27. [ ] **Slip PDF:** `?format=pdf`.
    - Tests: `application/pdf`, body starts with `%PDF`, `Content-Disposition` filename includes the employee code and month.
28. [ ] **Slip page:** month picker, print-friendly view, PDF download.
    - RTL test: the gross-only notice is shown, along with the earnings rows in the slip's currency.

    ✅ *Usable: HR produces monthly slips.*

## Slice J: Direct export
29. [ ] **CSV and Excel export API.**
    - Unit tests: formula-injection escaping (`= + - @ \t \r`).
    - Integration tests:
      - CSV and xlsx content types and `Content-Disposition`
      - row count and columns match the filters
      - reporting-currency column
      - an `exports` audit row is written
30. [ ] **Direct PDF export API:** ≤ 1,000 rows.
    - Tests: ≤ 1,000 rows → `%PDF`; > 1,000 rows → 422 `EXPORT_TOO_LARGE`; audit row written.
31. [ ] **Export menu on the list page:** CSV / Excel / PDF for the current filters. Until slice L, a 422 shows "too large — narrow the filters or use CSV/Excel".
    - RTL test: each format calls the export URL with the current filters; a 422 shows the message.

    ✅ *Usable: HR exports in all three formats; large PDFs come in slice L.*

## Slice K: Job queue and import
32. [ ] **Job queue and worker:** migration for `jobs`, enqueue, claim (`SKIP LOCKED`), `runOnce`, backoff, `max_attempts`, lease expiry, delayed `run_after`.
    - Integration tests (fixed clock):
      - a delayed job isn't claimed before `run_after`
      - a throwing handler is retried with backoff, then marked `failed` after 3 attempts
      - a `running` job with an expired lease is re-claimed
      - two concurrent claims never get the same job
33. [ ] **Import template + upload checks + single active import:** migration for `imports` and `import_rows`.
    - Unit tests: header match, type, size and row-count checks; required change type, date and note.
    - Integration tests:
      - the template has the header + 3 `EXAMPLE-*` rows
      - a valid upload → 202 and status `validating`
      - each failed check → 400 / 413
      - **T10:** upload while another import is active → 409 and nothing queued; accepted again after cancel
34. [ ] **Import validation job → preview.**
    - Unit tests on the row validator:
      - field rules
      - example rows rejected
      - in-file duplicate code or email
      - email belonging to another employee
      - effective date before that employee's latest change
      - unchanged detection
      - a country change with an unchanged base salary is rejected; with a new salary it becomes a relocation
      - **T18:**
        - a new code → `create` with a `hire` change on the row's hire date
        - a name/email-only change → `update` with no history
        - a hire-date change → rejected unless the import type is `correction`
        - an audited change to an exited employee → rejected unless `correction`; a name/email change to them is still applied
      - `isInfrastructureError` classifies SQLSTATE `08xxx`, `53xxx`, `57P01`, `40001`, `40P01` and socket errors as infrastructure, and everything else (e.g. `23505`, `TypeError`) as a row problem
    - Integration tests:
      - **T1:** the mixed fixture produces exact create / update / unchanged / rejected counts
      - **T3:** the rejected-rows CSV has the original header + `error`, one line per rejected row, and re-uploads cleanly after fixing
      - the `import_expire` job is scheduled at `preview_expires_at`
35. [ ] **Import cancel / confirm / apply.**
    - Integration tests:
      - **T2:** cancel leaves `employees` and `employee_changes` (history + audit) unchanged
      - confirm is only allowed from `awaiting_confirmation` (else 409)
      - **T7:** an imported salary change writes history with `source = import` and the import note
      - a newly created employee's history entry is `hire`, effective on its hire date, not the import's type or date
      - a relocation row writes a `relocation` change with the new currency (**T14** complete)
      - a row invalidated between preview and apply ends up rejected
      - **T8:** a failure injected after N rows, then a retry → every row applied exactly once, one history row per changed row, earlier rows untouched
      - **T15:** an unexpected error on row 3 → row 3 is rejected with the "unexpected error" reason, all other rows are applied, the import completes and the job isn't retried; an injected connection error → the job is retried and rows are still applied once (the same rule is checked in the validate step)
36. [ ] **Preview expiry and data clearing.**
    - Integration tests:
      - **T12:** clock 24 h past ready → expire job sets `expired`; confirm → 410 (also before the job runs); nothing is written; a new upload is accepted; running the job again is a no-op
      - **T13:** after completed, cancelled, failed or expired, `imports.file` and every `import_rows.raw` are NULL, while row number, code, outcome and errors remain
37. [ ] **Imports UI:**
    - template download, upload form, status polling
    - preview counts with **Import valid rows / Cancel** and the expiry time
    - rejected-rows download (while in preview)
    - final report and import history
    - the 409 "import in progress" message with a link
    - RTL tests: the preview shows counts and both actions call the right endpoints; an expired import shows "preview expired — upload again".

    ✅ *Usable: HR bulk-loads and updates employees from the template.*

## Slice L: Email export
38. [ ] **Emailed PDF export job.**
    - Integration tests (fake mailer):
      - `POST /exports/employees/email` → 202; the email goes to the requester's own address, links to `APP_BASE_URL/exports/:id` (not `/api/…`), and has no salary data (**T11**, server part)
      - **T9:** a failure after sending, then a retry → exactly 1 email; a failure before sending, then a retry → exactly 1 email
      - the file is not rebuilt on retry
      - the cleanup job is scheduled at `expires_at`
39. [ ] **Export download rules and cleanup.**
    - Integration tests:
      - the requester downloads → 200 and audited `downloaded`
      - **T4:** another HR user → 403, audited `forbidden`, no file returned
      - **T5:** clock past `expires_at` → 410, audited `expired`
      - **T6:** the cleanup job nulls the file and sets `deleted_at`, and is a no-op when run twice
40. [ ] **Email export UI + export download page:**
    - a 422 now opens "email it to you"
    - My exports page
    - the `/exports/:id` page fetches the file with credentials and saves it
    - RTL tests (**T11**, web part):
      - with a session, the page fetches `/api/exports/:id/download` and triggers the save
      - without a session it redirects to `/login?next=/exports/:id` and returns after login
      - 403 and 410 show clear messages

    ✅ *Usable: complete feature set.*

## Slice M: Wrap-up
41. [ ] **README and docs pass:** setup (Node via `.nvmrc`, `.env`, create DBs, migrate), run (API + web + Mailpit), seed with measured timing, test, demo video link, links to all docs. Final check that DECISIONS and PROMPTS are up to date.
