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
- **What:** Background jobs stored in PostgreSQL and picked up by a worker in the API process (`SELECT … FOR UPDATE SKIP LOCKED` or a library built on it, chosen in Phase 2). Retries up to 3 attempts.
- **Alternatives:** Redis + BullMQ; in-memory queue.
- **Why:** No extra infrastructure for a reviewer to install; jobs survive restarts (unlike in-memory); throughput needs are tiny (a few jobs per day).
- **Trade-off:** Polling adds a few seconds of pickup latency; not built for high job throughput (fine here).

## D-018 — Emailed exports go only to the requester, link bound to the requester
- **What:** Large PDF exports are emailed only to the logged-in user's own account address (no recipient field, no domain allowlist). The link requires login **and** that the downloader is the requester (`403` otherwise), expires in 24 h (`410` after), and the file is deleted at expiry by a scheduled cleanup job. Every download and refused attempt is audited.
- **Alternatives:** Typed-in recipient restricted to company domains (D-016); attaching the file.
- **Why:** The link already needs an HR login, so sending to anyone else adds risk without value. Removes mistyped-address leaks entirely, and binding the link to the requester means a forwarded email is useless.
- **Trade-off:** HR cannot hand an export to a colleague via the app; the colleague must run the export themselves. Needs delayed-job support in the queue for cleanup.

## D-019 — Import preview and confirm, one transaction per row
- **What:** Upload → background validation → preview (valid / rejected counts, rejected-rows CSV) → "Import valid rows" or "Cancel". Apply re-validates and upserts each row in its own transaction; changes create history entries with `source = import`. Cancel writes nothing.
- **Alternatives:** Import immediately after validation (D-015); one transaction for the whole file; batched transactions.
- **Why:** HR sees the outcome before anything is saved. Per-row transactions mean one failing row never rolls back good ones, and re-upload of fixed rows is safe because of upsert by employee code.
- **Trade-off:** Slower than batched writes (10k transactions — target < 60 s); data can change between preview and apply, handled by re-validating at apply time; staged rows are stored until the import finishes or is cancelled.

