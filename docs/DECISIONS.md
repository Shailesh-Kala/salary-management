# Decisions Log

Every meaningful decision: what, alternatives considered, why, and the trade-off.

## D-001 — Monorepo, single GitHub repo
- **What:** Backend, frontend and docs live in one public repo `salary-management`.
- **Alternatives:** Separate repos for API and UI.
- **Why:** The code is submitted as a single unit for assessment review, so one repo keeps everything (code, docs, history) in one place for the reviewer. Also gives one CI pipeline and atomic commits across API + UI.
- **Trade-off:** Slightly more complex CI paths if the two halves grow independently.

## D-002 — Node.js 24.21.0
- **What:** Pin Node 24.21.0 (current LTS line) via `.nvmrc`; `engines` will be added to `package.json` when it is created.
- **Alternatives:** Stay on Node 18 (end of life since April 2025) and pin Vitest to v3; Node 22 LTS.
- **Why:** Supported LTS line, compatible with current Vitest.
- **Trade-off:** Contributors and CI must use Node 24; older local installs need `nvm use`.

## D-003 — Store salaries in local currency; convert via HR-maintained USD rates
> **Amended by D-010** — pivot/default currency changed to INR.
- **What:** Salaries stored in the employee's country currency. One exchange-rate table (`units_per_usd`) maintained by HR; cross-currency conversion goes through USD at query time.
- **Alternatives:** Store everything in USD; fetch live rates from an FX API.
- **Why:** Local currency is the contractual truth and never drifts. Manual rates keep the system offline, deterministic and auditable.
- **Trade-off:** Comparisons are only as fresh as the last rate update; no historical-rate reporting.

## D-004 — CSV only for import/export (no native .xlsx)
> **Superseded by D-012** — export now supports CSV, Excel and PDF; import stays CSV.
- **What:** Import and export CSV with a published template; all-or-nothing import.
- **Alternatives:** `.xlsx` via a spreadsheet library.
- **Why:** Excel reads and writes CSV natively; avoids a heavy parser dependency and workbook edge cases (formulas, merged cells, multiple sheets).
- **Trade-off:** HR has to "Save As CSV" once; no formatting is preserved.

## D-005 — Salary history table doubles as the salary audit log
> **Superseded by D-011** — history now covers job title, department and lifecycle too.
- **What:** Current salary on the employee row; every change appends an immutable history row (old/new, who, when, effective date, reason, source).
- **Alternatives:** Generic JSON audit log for all entities; effective-dated salary rows only (no current salary on the employee).
- **Why:** One table serves audit, history UI and past-month slips. Current salary on the employee row keeps list and insight queries to a single table.
- **Trade-off:** Current salary is denormalised and must be written in the same transaction as the history row. Non-salary edits are not audited (open question OQ2).

## D-006 — Slips computed on demand, printed by the browser
> **Amended by D-012** — slips also get a server-generated PDF download.
- **What:** Slip built from the salary in effect at month end; HTML view, browser "Save as PDF"; not stored.
- **Alternatives:** Server-side PDF generation; storing generated slips.
- **Why:** No PDF dependency; slips are reproducible from history, so storage adds nothing.
- **Trade-off:** No stored slip archive; layout depends on the browser's print rendering.

## D-007 — Flat per-country estimated deduction on slips
> **Superseded by D-009** — slips show gross pay only.
- **What:** Deductions = gross × country `deduction_rate`, labelled as an estimate.
- **Alternatives:** Real per-country tax engines; no deductions at all.
- **Why:** The brief asks for a breakdown, not payroll. Real tax rules are out of scope.
- **Trade-off:** Net pay is indicative only (open question OQ1).

## D-008 — Single HR role
- **What:** All HR users have the same permissions; accounts created via seed/CLI.
- **Alternatives:** RBAC (viewer/editor/admin), self-signup.
- **Why:** One persona in the brief; a smaller auth surface to secure and test.
- **Trade-off:** No least-privilege separation between HR users.

## D-009 — Slips show gross pay only (supersedes D-007)
- **What:** Slip earnings = base ÷ 12 + allowances ÷ 12 = gross. No deductions, no net pay; slip states this explicitly.
- **Alternatives:** Flat per-country estimate (D-007); real tax engine.
- **Why:** Real deductions depend on tax brackets; a flat estimate is risky because it can be read as fact.
- **Trade-off:** Slip is not a full payslip; net pay must come from payroll.

## D-010 — INR as pivot and default reporting currency (amends D-003)
- **What:** Exchange rates stored as `inr_per_unit`; conversion `amount × rate[from] ÷ rate[to]`; reporting currency selectable, default INR.
- **Alternatives:** USD pivot with INR default display.
- **Why:** INR is the currency HR works in, so it is the natural default; storing rates against it ("1 USD = 83.20 INR") makes rate entry natural.
- **Trade-off:** None material — any pivot gives identical cross-rates.

## D-011 — Audit salary, job title, department and lifecycle changes (supersedes D-005)
> **Amended by D-033** — country changes (relocation) are audited too; snapshot includes country.
- **What:** One append-only change-history table: old → new per changed field, plus a snapshot of salary/title in effect, effective date, change type, required note, source, who, when. Current values stay on the employee row.
- **Alternatives:** Salary-only history (D-005); separate tables per field; generic audit of every column.
- **Why:** Promotions change title and pay together, so they belong in one event; the snapshot keeps past-month slip lookups a single indexed query.
- **Trade-off:** Current values are denormalised and must be written in the same transaction as the history row. Name/email edits are not audited.

## D-012 — Export in CSV, Excel and PDF; import stays CSV (supersedes D-004, amends D-006)
- **What:** Export the filtered list as CSV, `.xlsx` or PDF (PDF capped at 1,000 rows). Slips also get a server-generated PDF. Import remains CSV. Exports are audited.
- **Alternatives:** CSV only (D-004); uncapped PDF; `.xlsx` import too.
- **Why:** Excel export gives typed cells HR can pivot immediately; CSV stays the simple interchange format; PDF is for sharing/printing a readable report, which a 10k-row PDF is not.
- **Trade-off:** Two new dependencies (spreadsheet writer, PDF writer) chosen in Phase 2. PDF cap may require HR to narrow filters.

## D-013 — No deployment
- **What:** No hosting, live URL or deploy instructions; app runs locally against the reviewer's PostgreSQL.
- **Alternatives:** Render / Railway / Fly.io.
- **Why:** The assessment is reviewed from the repo and run locally; hosting adds infrastructure, secrets and cost without changing what is assessed.
- **Trade-off:** Reviewer must run it locally; README setup steps must be exact.

## D-014 — Employee lifecycle status derived from dates
> **See D-039** — "today" is defined in `APP_TIMEZONE`.
- **What:** Store `exit_type`, `notice_date`, `last_working_day`; status (`active` / `on_notice` / `exited`) is computed from them and today's date.
- **Alternatives:** Stored status column updated by a scheduled job; HR manually marks "exited".
- **Why:** Status is always computed from the dates, so it can never drift from them — there is no stored status to keep in sync and nothing for HR to forget to update.
- **Trade-off:** Status depends on "today", so the clock must be injected for deterministic tests; filtering by status is an expression over dates (fine at 10k rows, indexable on `last_working_day`).

## D-015 — CSV import as a background job with partial accept and a rejected-rows report
> **Amended by D-019** — adds a preview/confirm step and one transaction per row.
- **What:** Template CSV with example rows (`EXAMPLE-*`, auto-rejected if left in). Upload is checked synchronously (type, ≤ 5 MB, header, 1–20,000 rows, change type/date/note), then queued (`202` + job ID). Valid rows are upserted by `employee_code`; invalid rows are rejected with reasons and downloadable as a CSV with an `error` column. One import runs at a time.
- **Alternatives:** Synchronous all-or-nothing import (previous default); `.xlsx` import.
- **Why:** HR needs to see which rows were accepted and rejected; a background job keeps a 20,000-row file off the request path. Partial accept means one typo doesn't block 9,999 good rows, and the rejected-rows file closes the fix-and-retry loop.
- **Trade-off:** A file can be half-applied, so the report must be clear; more moving parts (job table, row results, polling UI) than a synchronous import.

## D-016 — Large PDF exports via background job, delivered as an expiring link by email
> **Amended by D-018** — email goes only to the requester's own address; no recipient field or domain allowlist.
- **What:** PDF ≤ 1,000 rows downloads directly. Above that, HR enters a recipient (prefilled with their own email, restricted to allowed company domains), a background job builds the PDF, and an email with a login-protected link expiring in 24 h is sent. No attachment.
- **Alternatives:** Hard cap with "narrow your filters"; attach the PDF to the email.
- **Why:** A large PDF takes too long to build within a request, so it is built in the background and the user is notified by email when it is ready. Attachments of full salary data can't be revoked or access-controlled once sent; a link keeps the data behind authentication and an expiry.
- **Trade-off:** Recipient must log in to download; adds SMTP config and a mail catcher for local runs.

## D-017 — PostgreSQL-backed job queue
> **Amended by D-020** — retries must be idempotent (skip finished rows, never re-send email).
- **What:** Background jobs stored in PostgreSQL and picked up by a worker in the API process (`SELECT … FOR UPDATE SKIP LOCKED` or a library built on it, chosen in Phase 2). Retries up to 3 attempts.
- **Alternatives:** Redis + BullMQ; in-memory queue.
- **Why:** No extra infrastructure for a reviewer to install; jobs survive restarts (unlike in-memory); throughput needs are tiny (a few jobs per day).
- **Trade-off:** Polling adds a few seconds of pickup latency; not built for high job throughput (fine here).

## D-018 — Emailed exports go only to the requester, link bound to the requester
> **Amended by D-032** — the email links to an app page, which downloads via `fetch`.
- **What:** Large PDF exports are emailed only to the logged-in user's own account address (no recipient field, no domain allowlist). The link requires login **and** that the downloader is the requester (`403` otherwise), expires in 24 h (`410` after), and the file is deleted at expiry by a scheduled cleanup job. Every download and refused attempt is audited.
- **Alternatives:** Typed-in recipient restricted to company domains (D-016); attaching the file.
- **Why:** The link already needs an HR login, so sending to anyone else adds risk without value. Removes mistyped-address leaks entirely, and binding the link to the requester means a forwarded email is useless.
- **Trade-off:** HR cannot hand an export to a colleague via the app; the colleague must run the export themselves. Needs delayed-job support in the queue for cleanup.

## D-019 — Import preview and confirm, one transaction per row
> **Amended by D-031** — previews expire after 24 h; raw row data is cleared when the import ends.
- **What:** Upload → background validation → preview (valid / rejected counts, rejected-rows CSV) → "Import valid rows" or "Cancel". Apply re-validates and upserts each row in its own transaction; changes create history entries with `source = import`. Cancel writes nothing.
- **Alternatives:** Import immediately after validation (D-015); one transaction for the whole file; batched transactions.
- **Why:** HR sees the outcome before anything is saved. Per-row transactions mean one failing row never rolls back good ones, and re-upload of fixed rows is safe because of upsert by employee code.
- **Trade-off:** Slower than batched writes (10k transactions — target < 60 s); data can change between preview and apply, handled by re-validating at apply time; staged rows are stored until the import finishes or is cancelled.

## D-020 — Idempotent job retries
> **Amended by D-037** — only infrastructure errors fail the job; unexpected row errors reject just that row.
- **What:** Import apply saves each row's outcome in the same transaction as that row's employee and history changes; on retry, rows with a final outcome are skipped. Import validation only rebuilds preview rows, so re-running it is harmless. Export jobs skip rebuilding an existing file and mark `email_sent_at` before sending (cleared if the send fails with an error), so a retry never re-sends. Cleanup is a no-op on an already-deleted file.
- **Alternatives:** Rely on upsert by `employee_code` alone; mark the email sent only after a successful send (at-least-once).
- **Why:** Upsert alone makes the employee row correct but still writes a second history entry and re-runs work; with one transaction per row a crash always leaves a partial import, so the row outcome must be the single source of truth for "done". At-least-once email could message the user twice after a crash between send and mark.
- **Trade-off:** At-most-once email: a hard crash during the SMTP call can lose the email — the download link is still on the job status page. One extra write per row (in the same transaction, so negligible).

## D-021 — One active import at a time, org-wide
- **What:** A new upload is refused (`409`) while any import is queued, validating, awaiting confirmation, or applying — enforced by a database constraint (partial unique index on active import jobs). Any HR user can cancel the pending import.
- **Alternatives:** Parallel previews with serialised apply (previous default); one active import per user.
- **Why:** A preview built while another import is pending or applying could be stale by the time it is confirmed; a single active import keeps previews trustworthy and removes all import-vs-import races. A DB constraint closes the race between two simultaneous uploads.
- **Trade-off:** A forgotten preview blocks other imports until someone cancels it; HR teams must coordinate on bulk uploads (expected to be rare).

## D-022 — Run TypeScript directly on Node 24 (no server build step)
- **What:** The server runs `.ts` files with Node's native type stripping (`node src/main.ts`); `tsc --noEmit` type-checks in lint/CI; tsconfig uses `erasableSyntaxOnly` (no enums/namespaces/parameter properties).
- **Alternatives:** `tsc` build to `dist/`; `tsx`/`ts-node` runtime.
- **Why:** One less tool and build artefact; what runs is exactly what is reviewed.
- **Trade-off:** Restricts a few TS-only syntax features; if a dependency or feature needs full transpilation, fall back to `tsx`.

## D-023 — Express 5
- **What:** HTTP layer on Express 5.
- **Alternatives:** Fastify, Koa, NestJS.
- **Why:** Most widely known Node framework (easy to review), first-class with Supertest, and v5 forwards rejected promises to the error handler (no async wrappers).
- **Trade-off:** Slower than Fastify and no built-in schema validation (zod covers it); irrelevant at this load.

## D-024 — `pg` with hand-written parameterised SQL, SQL migrations (no ORM)
- **What:** Repositories use `pg` with `$n` parameters; migrations are SQL files run by `node-pg-migrate`.
- **Alternatives:** Prisma, Drizzle, Kysely, TypeORM.
- **Why:** The interesting queries (medians, outliers, `FILTER`, `SKIP LOCKED`, partial unique indexes, triggers) are native SQL anyway; plain SQL is transparent to a reviewer and has no generator/runtime layer.
- **Trade-off:** Row types are written by hand and not checked against the schema at compile time — covered by integration tests on every repository.

## D-025 — scrypt passwords and a JWT session cookie
> **Amended by D-038** — sessions are now revocable (token version + disabled flag checked per request).
- **What:** Passwords hashed with Node's built-in `crypto.scrypt` (random salt, `timingSafeEqual`); session is an 8 h HS256 JWT (`jose`) in an httpOnly, SameSite=Strict cookie.
- **Alternatives:** argon2/bcrypt native modules; server-side sessions table; token in `localStorage`.
- **Why:** scrypt is a memory-hard KDF with zero dependencies; cookie + SameSite=Strict blocks XSS token theft and CSRF; stateless tokens need no session store.
- **Trade-off:** Tokens cannot be revoked before expiry (logout clears the cookie only); denylist or sessions table if revocation is needed.

## D-026 — Frontend: Vite, MUI, MUI X DataGrid (server mode), TanStack Query
- **What:** React 19 + Vite + MUI; MUI X DataGrid (community) for the employee list with server-side paging/sorting; TanStack Query for fetching, caching and job polling; React Router. npm workspaces hold `server` and `web`.
- **Alternatives:** Create React App (deprecated); hand-rolled table; Redux.
- **Why:** DataGrid gives the Excel-like table HR expects with server mode built in; TanStack Query handles polling/caching without global state code.
- **Trade-off:** DataGrid community lacks Excel-style pivots (not needed); bundle size is larger than a plain table.

## D-027 — Integration tests on a real PostgreSQL test database
- **What:** Integration tests run against `TEST_DATABASE_URL` (migrated once, truncated per test); CI uses a `postgres:16` service container. Unit tests use fake repositories and need no DB.
- **Alternatives:** In-memory Postgres emulation (pg-mem); SQLite.
- **Why:** Emulators don't support `percentile_cont`, `SKIP LOCKED`, partial unique indexes or triggers faithfully — exactly what must be tested. A local Postgres already exists.
- **Trade-off:** Integration tests need a running Postgres and are slower than in-memory ones (still seconds).

## D-028 — "Annual salary" = base salary + allowances
- **What:** Comparisons, insights, list sorting and outliers use annual gross (base + allowances); base and allowances are still shown separately.
- **Alternatives:** Base salary only.
- **Why:** Allowances are part of what the org pays; comparing base only would under-state pay where allowances are large.
- **Trade-off:** Pay-band comparisons that HR does on base alone need the separate columns.

## D-029 — Offset pagination for the employee list
- **What:** `LIMIT/OFFSET` with `pageSize ≤ 100` and a stable `ORDER BY col, id`; exports use keyset paging internally.
- **Alternatives:** Keyset (cursor) pagination for the UI.
- **Why:** DataGrid's page-number UI maps directly to offset; at 10k–100k rows deep offsets cost milliseconds.
- **Trade-off:** Degrades at millions of rows; keyset is the upgrade path.

## D-030 — Hand-rolled queue on a `jobs` table, single serial worker
- **What:** `jobs` table; claim with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`; lease via `locked_until` for crash recovery; backoff via `run_after`; one in-process worker loop processing jobs serially; `runOnce()` for tests; all times from the injected clock.
- **Alternatives:** pg-boss; graphile-worker; BullMQ (Redis).
- **Why:** About 100 lines that cover everything needed (delay, retry, lease) with deterministic tests; domain state (preview, cancel, counts) lives in our own tables either way, so a library would add a second schema without removing code.
- **Trade-off:** We own the queue code; serial processing means a long import delays exports by up to a minute. pg-boss is the upgrade path if job types or volume grow.

## D-031 — Import previews expire after 24 h; raw row data cleared when an import ends
- **What:** When a preview is ready, `preview_expires_at = now + 24 h` and an `import_expire` job is scheduled; it moves a still-pending import to `expired`. Confirm also checks the expiry itself (`410`). When an import reaches `completed`, `cancelled`, `failed` or `expired`, the uploaded file and `import_rows.raw` are set to NULL in the same transaction; row number, employee code, outcome and errors remain.
- **Alternatives:** Manual cancel only (D-021); keep raw rows for later download; purge whole import records on a schedule.
- **Why:** A forgotten preview would otherwise block all imports indefinitely and keep salary data at rest for no purpose. The check at confirm time means correctness never depends on job timing.
- **Trade-off:** The rejected-rows CSV is only downloadable while the import is in preview/applying; rows rejected at apply time are listed (code + reasons) but HR fixes them from their own file.

## D-032 — Export email links open an app page, which downloads via `fetch`
- **What:** The email links to `APP_BASE_URL/exports/:id` (SPA route). The page checks the session (redirects to `/login?next=/exports/:id` if needed — relative paths only), then calls `GET /api/exports/:id/download` with `fetch` and saves the blob.
- **Alternatives:** Direct API link (breaks); `SameSite=Lax` cookie; a one-time token in the link.
- **Why:** With a `SameSite=Strict` cookie, a link clicked in Gmail/Outlook web is a cross-site navigation and the cookie is withheld, so a direct API link would always return `401`. A `fetch` from the app's own page is same-site and carries the cookie. Keeping Strict keeps CSRF protection simple; a token in the URL would be a bearer secret sitting in mailboxes.
- **Trade-off:** One extra page in the SPA; download needs JavaScript (fine for this app).

## D-033 — Relocation as an audited change type
- **What:** Country changes only through a `relocation` change event, which must include the new base salary and allowances (in the new country's currency). Snapshots store `country_code` and `currency_code`, so earlier history and slips keep the old currency. Imports relocate a row only when its base salary also changed; otherwise the row is rejected.
- **Alternatives:** Country immutable (re-hire as a new employee); allow country edits and convert salary automatically using the current rate.
- **Why:** Relocations are real HR events and affect pay; re-hiring would break history. Automatic conversion would invent a salary — the new contract amount must come from HR.
- **Trade-off:** In an import, a relocation whose new salary happens to equal the old number is rejected (very unlikely; do it through the UI).

## D-034 — Exchange-rate changes are audited
- **What:** Every rate update writes an append-only `exchange_rate_changes` row (old → new rate and as-of date, who, when) in the same transaction; shown on the rates page.
- **Alternatives:** Only `updated_by`/`updated_at` on the rate row.
- **Why:** Rates change every converted figure in the app; HR must be able to see who changed a rate and what it was before.
- **Trade-off:** Still no point-in-time reporting with historical rates (out of scope) — the table is an audit trail, not used for conversion.

## D-035 — Build in vertical slices
- **What:** PLAN.md is ordered as slices (API task(s) followed by the UI that uses them), so the app is usable after each slice; job queue, import and email export come last.
- **Alternatives:** All APIs first, all UI last.
- **Why:** Each slice can be demoed and reviewed end-to-end, and UI feedback can change the API early instead of at the end.
- **Trade-off:** Some UI is first built with a temporary behaviour (e.g. the PDF "too large" message before email export exists) and revisited in a later slice.

## D-036 — Explicit import row rules; hire-date corrections; exited employees correction-only
- **What:** One pure row-rules function, used by both preview and apply, decides each row: new code → created with a `hire` change effective on the row's hire date; name/email-only differences → updated, no history (same as UI); audited field differences → one change with the import's type/date; country + salary → `relocation`; hire-date change only in a `correction` import; audited changes to exited employees only in a `correction` import. In the UI, hire date becomes correctable through a `correction` change event (≤ first non-hire change, ≤ notice date).
- **Alternatives:** Ignore name/email/hire-date columns for existing employees; reject any row that touches them; let imports change hire dates freely.
- **Why:** HR must be able to predict what a re-upload does, and the import must never allow something the UI forbids. A hire change dated by the import ("FY26 review, 1 Apr") would put a new joiner's history at the wrong date.
- **Trade-off:** Hire-date fixes by import require a separate `correction` import; the original `hire` entry stays as recorded (history is immutable), with the correction shown after it.

## D-037 — Row-level error isolation in import jobs
- **What:** Each row's transaction is wrapped in `try/catch`. Infrastructure errors (SQLSTATE `08`, `53`, `57P`, `40001`, `40P01`, socket errors) are re-thrown so the job is retried (skipping finished rows); any other error rolls back just that row, marks it rejected with an "unexpected error" reason and a reference, logs without row data, and continues.
- **Alternatives:** Let any error fail the job (previous behaviour — one bad row would fail the import three times, then the whole import); treat every error as a row error (a lost connection would reject thousands of good rows).
- **Why:** A bad row is a data problem and must not block 9,999 good rows; a lost connection is temporary and the retry will succeed.
- **Trade-off:** A misclassified error is either rejected (HR re-uploads that row) or retried (bounded by 3 attempts); the classifier is unit-tested.

## D-038 — Revocable sessions: token version + disabled flag checked on every request
- **What:** `hr_users.token_version` and `disabled_at`; the JWT carries `tv`; `requireAuth` loads the user by ID per request and rejects if disabled or `tv` is stale. Logout and `npm run user:disable` increment `token_version`.
- **Alternatives:** Stateless JWT only (up to 8 h of access after removal); server-side session table; shorter token lifetime with refresh tokens.
- **Why:** Removing an HR user must cut off salary access immediately. One primary-key lookup per request is negligible at this scale and keeps the cookie/JWT design.
- **Trade-off:** Every request touches the DB (already true for every salary endpoint); logout ends the user's sessions on all devices.

## D-039 — "Today" in the org time zone; DATE columns as strings
- **What:** `APP_TIMEZONE` (default `Asia/Kolkata`) defines "today" for all date rules (`Intl.DateTimeFormat`, no library). `DATE` columns are returned by `pg` as `YYYY-MM-DD` strings (type parser 1082) and handled as strings in server and web; DB sessions run in UTC; instants are `timestamptz`. Tests run with `TZ=America/Los_Angeles`.
- **Alternatives:** UTC "today" (HR in India would see yesterday's date until 05:30); server local time (varies by machine); a date library.
- **Why:** HR works in IST and INR is the default currency; converting `DATE` to JS `Date` is the classic off-by-one-day bug. Running tests in a different zone makes any hidden local-time dependency fail loudly.
- **Trade-off:** Employees in other countries are judged by the IST calendar day (e.g. a US last working day ends at IST midnight) — acceptable for an HR-side tool.
