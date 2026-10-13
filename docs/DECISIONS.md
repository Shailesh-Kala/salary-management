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

## D-040 — TypeScript 6.0 (not 7.0)
- **What:** Pin `typescript@6.0.3`; all tool versions pinned exactly in `package.json`.
- **Alternatives:** TypeScript 7.0 (latest, native Go compiler).
- **Why:** `typescript-eslint@8.71` supports TypeScript `<6.1` only; 6.0 has every flag we need (`erasableSyntaxOnly`, `verbatimModuleSyntax`).
- **Trade-off:** Misses TS 7's faster type-checking; upgrade when typescript-eslint supports it.

## D-041 — Reference data (countries, rate snapshot) in migration 0001 via `load_reference_data()`
- **What:** Migration `0001` creates a SQL function `load_reference_data()` that upserts the 8 countries and the rate snapshot, and calls it once. The test helper `resetDb()` empties every table and calls the same function.
- **Alternatives:** Load rates in the seed script only (countries need rates through their FK, so the app would be unusable before seeding); duplicate the data in a test fixture.
- **Why:** Countries and rates are needed in every environment, including an unseeded one; one SQL source of truth for both the app and tests.
- **Trade-off:** The function resets rates to the snapshot if called again, so only the migration, the seed and tests call it (noted in the migration).

## D-042 — Two login rate limits: per IP + email and per IP
- **What:** Login is limited to 5 attempts/min per IP + email and, independently, 20 attempts/min per IP regardless of email.
- **Alternatives:** Per IP + email only; per IP only; account lockout after N failures.
- **Why:** The per-email limit slows guessing one account; the per-IP limit stops one machine spraying a common password across many accounts. Lockout would let anyone lock HR out by typing their email.
- **Trade-off:** Several HR users behind one office NAT share the 20/min budget — ample for normal logins.

## D-043 — `user:create` generates the password and prints it once
> **Amended by D-044** — `user:reset-password` and `user:enable` added; disable + re-create is no longer the rotation path.
- **What:** `npm run user:create -- <email> "<name>"` creates the account with a random 144-bit password (`randomBytes(18)`, base64url) and prints it once. `user:disable` sets `disabled_at` and ends sessions.
- **Alternatives:** Password as a CLI argument (lands in shell history); interactive hidden prompt (extra terminal-handling code); env variable.
- **Why:** Nothing sensitive in shell history or process lists, no prompt code, and the password is stronger than a typical chosen one.
- **Trade-off:** There is no change-password feature (password reset is out of scope), so HR keeps the generated password; to rotate, disable the account and create a new one.

## D-044 — `user:reset-password` and `user:enable` instead of disable + re-create
- **What:** `user:reset-password -- <email>` sets a new generated password (printed once) and increments `token_version`; `user:enable -- <email>` clears `disabled_at` (no version bump, so sessions from before the disable stay ended).
- **Alternatives:** Disable the account and create a new one (D-043's workaround); self-service password change in the UI.
- **Why:** Re-creating fails because the disabled account still owns the email, and would split one person's audit history (`changed_by`, exports) across two user IDs. A UI password change is out of scope.
- **Trade-off:** Password changes still need someone with server/DB access to run the CLI.

## D-045 — Seed relative to "today", refuse to overwrite without `--reset`
- **What:** The generator takes `(count, seed, today)`; hire, notice and last-working-day dates are offsets from `today`, so the status mix (active / on notice / exited) is realistic whenever it runs. Seeding refuses a database that already has employees unless `--reset` is passed, which truncates employees and history and restores the rate snapshot. The seed admin is created only if missing.
- **Alternatives:** Fixed calendar dates (byte-identical forever, but "on notice" employees become "exited" as time passes); always truncate.
- **Why:** Demo data should look current; an accidental `npm run seed` against a database with real edits must not wipe it.
- **Trade-off:** Output is identical only for the same day; tests pin `today`, so they stay deterministic.

## D-046 — List state in the URL; any 401 sends the user to login
- **What:** The employee list keeps page, page size, sort, filters, search and currency in the URL query string. A shared `createQueryClient()` treats a 401 from any query as "session ended" and clears the cached user, so `RequireAuth` redirects to `/login?next=<current URL>`; 4xx errors are not retried.
- **Alternatives:** List state in React state only; a 401 check in every page.
- **Why:** URLs survive reloads, can be bookmarked or shared between HR colleagues, and make the post-login return land on exactly the same filtered view. One central 401 rule covers every future page.
- **Trade-off:** URL parameters must be validated on the server anyway (they are), and the page has to tolerate hand-edited URLs (invalid values get a 400 shown in an alert).

## D-047 — Slip PDFs with pdfkit's built-in fonts; amounts shown with currency codes
- **What:** Slips are rendered server-side with `pdfkit` (A4, Helvetica), amounts as `INR 4,63,108.33` (en-IN grouping) rather than with symbols; the title metadata is `Salary slip <code> <month>`; the file is sent as `slip-<code>-<month>.pdf` with a quoted `Content-Disposition`.
- **Alternatives:** Embed a Unicode font (e.g. Noto Sans) to print ₹/€/£; HTML-to-PDF via a headless browser.
- **Why:** The built-in fonts lack the ₹ glyph; currency codes are unambiguous for every currency without shipping a ~400 kB font. A headless browser is a heavy dependency for one page.
- **Trade-off:** Slips show "INR" instead of "₹". Swapping in an embedded font is a one-file change if symbols are wanted.

## D-048 — Override exceljs's `uuid` dependency to 11.1.1
- **What:** `package.json` `overrides` pins `exceljs → uuid` to 11.1.1 (exceljs 4.4.0 asks for uuid 8). `npm audit` reports 0 vulnerabilities.
- **Alternatives:** `npm audit fix --force` (downgrades exceljs to 3.4.0, a breaking change); accept the moderate advisory; switch spreadsheet library.
- **Why:** The advisory (GHSA-w5hq-g745-h8pq) is in uuid's v3/v5/v6 with a caller buffer; exceljs only calls `v4()`, which 11.1.1 still exports in CommonJS — verified by the export tests and a workbook smoke test.
- **Trade-off:** We run exceljs with a newer uuid than it declares; revisit when exceljs releases an update.

## D-049 — Indian digit grouping for INR, international grouping for other currencies (display only)
- **What:** The web UI and PDFs group INR in lakhs/crores (`₹12,34,567.89`, `INR 4,63,108.33`) and every other currency, including EUR, in thousands (`$1,234,567.89`, `USD 108,764.96`). CSV and Excel keep plain numbers with no grouping (Excel amount format `0.00`).
- **Alternatives:** en-IN grouping for every currency (previous behaviour); international grouping everywhere; thousands separators in Excel's display format.
- **Why:** HR reads rupees in lakhs, but `USD 1,08,764.96` looks wrong to anyone used to dollar amounts. Files must stay machine-friendly so Excel can calculate and a CSV can be re-imported.
- **Trade-off:** Mixed-currency views use two grouping styles side by side.

## D-050 — Seed includes a year of pay history
- **What:** Staying employees hired before the review cycle get an annual review (~85%, +3–12%) ~150–200 days ago; ~10% of those not at the top title get a later promotion to the next title in their department (+10–20%); ~3% are relocated to another country with new pay from their title's band in that currency. Leavers get no pay changes. The employee row is the latest state.
- **Alternatives:** Hires and exits only (previous seed); random changes without department/title structure.
- **Why:** History timelines, slips across months and "recent pay changes" (Q6) need realistic data for review and demo; staying within one year keeps dates valid relative to `today`.
- **Trade-off:** The seed takes ~1.7 s instead of ~1.3 s and writes ~19k history rows; changing the generator changes the deterministic data set.

## D-051 — Import data cleared by a trigger; failed jobs end their import
- **What:** A `BEFORE UPDATE` trigger on `imports` sets `file` and every `import_rows.raw` to NULL whenever the status becomes `completed`, `cancelled`, `failed` or `expired`. Job handlers may define `onGiveUp`, which runs before a job is marked failed for good; the import jobs use it to mark the import `failed`. Confirm and upload first expire any overdue preview, so expiry never waits on the job.
- **Alternatives:** Clear in each service/job path that ends an import; a periodic sweep for stuck imports.
- **Why:** One rule in the database covers every path, now and later, in the same statement. Without `onGiveUp`, an import whose job used up its retries stayed `validating`/`applying` and blocked all uploads.
- **Trade-off:** The clearing lives in SQL rather than TypeScript, so it is less visible when reading the services; T13 covers it.

## D-052 — Emailed exports: injectable mailer, optional SMTP, failed exports drop their file
- **What:** Email goes through a small `Mailer` interface (`send({to, subject, text})`); production uses nodemailer over SMTP, tests use a fake that records what was delivered. `SMTP_HOST` is optional: without it the API runs and an emailed export fails with "Email is not configured". `APP_BASE_URL`, `SMTP_PORT` (default 2525), `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are read from the environment. The email contains only a link to the app page and its expiry time. When the export job gives up, the export is marked `failed` (with the error) and any built file is deleted.
- **Alternatives:** Require SMTP settings at start-up; call nodemailer directly in the job; keep the built file of a failed export until its expiry.
- **Why:** A fake mailer keeps tests fast and offline, and lets them count deliveries (T9). Optional SMTP means people who never email exports (and CI) need no mail settings. A file that nobody was told about has no purpose, so keeping salary data for it would be pointless.
- **Trade-off:** A missing mail setting shows up as a failed export, not at start-up. The cleanup job scheduled for a failed export still runs once and finds nothing to delete.

## D-053 — Export downloads audit what involves the file
- **What:** `GET /api/exports/:id/download` records `downloaded`, `forbidden` or `expired` in the append-only `export_downloads` before returning anything. The requester check comes first, so someone else always gets 403, even after expiry. An export that is still queued (409), failed (410), unknown, or direct (404) is not audited.
- **Alternatives:** Audit every request including those; return 404 instead of 403 to hide that the export exists.
- **Why:** The audit exists to answer "who tried to get this file". A request for something with no file says nothing about that, and the outcome list in the design has only three values. 403 matches the design and the export ids are random UUIDs, so guessing one is impractical.
- **Trade-off:** A colleague with a valid id learns that an export exists; the file stays out of reach.

## D-054 — Too-large PDF opens an email offer; the download page saves on arrival
- **What:** When a PDF export returns `422 EXPORT_TOO_LARGE`, the export menu opens a dialog stating the row count and limit and offering "Email me the PDF" (to the signed-in user's own address), instead of only showing an error. The page the email links to (`/exports/:id`) starts the download as soon as it opens and offers "Download again"; it does not re-download when the browser window regains focus. "My exports" (`/exports`) lists the user's emailed exports and refreshes every 5 s while one is being prepared.
- **Alternatives:** Keep the error message and add a separate "Email PDF" menu item; make the user click a button on the download page.
- **Why:** A user who hit the limit is one click from what they wanted. The link in the email should do what it says without another click. Every download is audited, so accidental repeats (focus, refetch) would pollute the trail.
- **Trade-off:** Opening the link counts as a download even if the browser blocks the file save; "Download again" covers that.

## D-055 — Job status lives on the Imports and Exports pages, not a separate jobs page
- **What:** The requirements promised one "job status page" listing every job with progress. We built the status where each job's result is used instead: the Imports history and per-import page (status, preview counts, final report, rejected rows) and the My exports page (status, expiry, open link). Both refresh while work is running. Progress is shown as a state (checking rows, importing), not as rows processed.
- **Alternatives:** A generic Jobs page over the `jobs` table; a progress counter written by the worker.
- **Why:** HR never works with "jobs"; they work with an import or an export, and each page already links to its report or file. A generic page would show the same information a second time, and a progress counter means extra writes during an import for little value at 20,000 rows.
- **Trade-off:** No single place to see everything running; a user watching a very large import sees "Importing…" without a percentage.

## D-056 — Plain-language errors, checked forms, and a start-up migration check
> **Amended by D-057** — the create form now uses the server's own schema, so its rules are no longer written twice.
- **What:** (1) One module (`lib/zod-messages.ts`) replaces zod's default wording for every validation failure that has no message of its own: "This field is required", "This field cannot be empty", "Use at most N characters", "Enter a valid email address…", "Enter a valid date as YYYY-MM-DD", "Choose one of: …", "Unknown field: …". Fields that only had a regular expression (country and currency filters) got messages. (2) The create-employee form checks its fields before sending (what is missing, what format is expected) and sends nothing while invalid; the server's messages are still shown if it disagrees. (3) The API refuses to start if migration files exist that the database has not applied, naming them and the command to run. (4) SMTP failures become sentences naming the setting to check (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`/`SMTP_PASS`), and unexpected server errors show `(ref <request id>)` in the UI.
- **Alternatives:** Per-field messages on every schema; a shared validation schema between server and web; running migrations automatically at start-up; leaving raw errors.
- **Why:** Found by using the app: a form that dropped blank fields produced "expected string, received undefined" on every field; a dev database one migration behind produced 500s on one page only; a mistyped mail host showed `getaddrinfo ENOTFOUND` to HR. One central map covers every current and future schema; the start-up check turns a confusing runtime failure into one clear line; the reference lets a screenshot be matched to a log line.
- **Trade-off:** The create form's rules were first written twice and could drift (replaced by one shared schema in D-057); the other forms rely on their disabled-until-valid buttons plus the server's messages. Migrations stay a deliberate manual step, so a developer who pulls new code must run them (the start-up check says so).

## D-057 — The employee field rules are one schema, shared by the server and the web form
- **What:** The create-employee schema, the amount rules, the date, country and note rules, the note length limits and the message map move to `server/src/shared/` (`employee-rules.ts`, `zod-messages.ts`). Nothing in that folder may import anything except zod and its own files, and a test checks that. The web app imports it through a `@shared` alias (Vite and TypeScript paths), and the create form validates with `createEmployeeSchema` before sending, so a rule and its message cannot differ between the two. Checks that need the database (duplicate code or email, hire date and effective-date order) stay on the server; the form still shows the messages the server returns. The change, exit and withdraw dialogs and the import form take their note limits from the same file. Wording is now one set everywhere, including CSV import messages ("Enter a plain number like 95000 or 95000.50, with no commas or currency symbols").
- **Alternatives:** A separate workspace package (Node does not strip types from `.ts` files inside `node_modules`, so the server would need a build step); a test that feeds the same inputs to both copies and checks they agree; leaving the rules duplicated.
- **Why:** Duplicated rules drift, and the user sees the difference as two different messages for the same mistake. An alias needs no build step and no new package, and the server keeps running its TypeScript directly.
- **Trade-off:** The web code depends on a folder inside the server, held in check by the zod-only rule and its test. zod is now part of the web bundle; the server and the web app pin the same exact version and resolve to one installed copy (the message map sets zod's global config, so a second copy would lose the messages), and a test checks both. Only the create-employee schema is shared so far; the change, exit and rate schemas stay server-side, and their dialogs rely on disabled-until-valid buttons and the server's messages.
