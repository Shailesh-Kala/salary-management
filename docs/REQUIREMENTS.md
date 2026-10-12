# Requirements

## 1. Goal
Replace ACME's Excel-based salary tracking with a web application in which the HR Manager can:
1. Manage employee and salary records for about 10,000 employees across several countries, safely and with an audit trail.
2. Track each employee's lifecycle: active, serving notice, exited.
3. Answer common questions about how the org pays people without building pivot tables.
4. Produce a monthly salary slip for any employee.
5. Move data in and out in the formats HR already uses: CSV in (from a template), CSV/Excel/PDF out. Large imports and exports run as background jobs.

**Success:** the HR Manager can import the existing spreadsheet, find any employee in a few seconds, change a salary or job title with a recorded note, and answer the insight questions in §4.4 from one screen.

## 2. Persona
**HR Manager, ACME (primary and only user role)**
- Fluent in Excel: filters, sorts, pivots, VLOOKUP. Not technical.
- Today: one or more large workbooks, copy-pasting between sheets, manual currency conversion, no reliable history of who changed what.
- Pain points: slow lookups, accidental overwrites, no audit trail, cross-country comparisons done by hand, slips assembled manually, notice periods tracked on the side.
- Needs: familiar table-style UI (filter, sort, search, export), numbers they can trust and trace, nothing that looks like payroll-engine complexity.

## 3. Scope at a glance
| # | Feature | In scope |
|---|---|---|
| F1 | Authentication (HR Manager login) | ✅ |
| F2 | Employee and salary CRUD with list, search, filter, sort, pagination | ✅ |
| F3 | Employee lifecycle: resignation, notice period, last working day, exit | ✅ |
| F4 | Pay insights (fixed set of questions) | ✅ |
| F5 | Multi-currency comparison through a reporting currency (default INR) | ✅ |
| F6 | Monthly salary slip (gross pay breakdown) | ✅ |
| F7 | Change history and audit log (salary, job title, department, lifecycle) | ✅ |
| F8 | Import (CSV, background job with accepted/rejected report) and export (CSV, Excel, PDF; large PDFs by background job and email) | ✅ |
| F9 | Background job queue (PostgreSQL-backed) and job status page | ✅ |

## 4. In-scope features

### 4.1 F1: Authentication
- Email and password login for HR users. Accounts are created by a seed script or CLI; there is no self-signup.
- Every HR user has the same permissions (a single role).
- Session ends on logout or expiry.
- Details are in §7.

### 4.2 F2: Employee and salary management
- **List:** server-side pagination (default 25 rows, max 100), sorting, filters (country, department, job title, status) and free-text search (name, employee code, email).
- **Create / view / edit** an employee, including their salary.
- **Changes that need a note:** changing salary, allowances, job title or department is a *change event*. It requires:
  - a **change type**: `annual_review`, `promotion`, `market_adjustment`, `correction` or `other`
  - an **effective date**
  - a **note**, required free text, e.g. appreciation or feedback such as *"Led the payments migration, consistently exceeds expectations"*
- **Back-dated changes** are allowed (effective date ≤ today) and need the same required note. Future-dated changes are not allowed.
- **Concurrent edits** are rejected if someone else edited the record in the meantime (optimistic locking), so two HR users can't silently overwrite each other.
- **Validation:**
  - salary amounts must be > 0 with at most 2 decimals
  - country must be supported
  - email and employee code must be unique
  - effective date must be ≤ today and ≥ the employee's latest change effective date, so history stays in order
  - note must be 5–1000 characters

### 4.3 F3: Employee lifecycle (resignation and notice period)
**Statuses:**
| Status | Meaning | How it is set |
|---|---|---|
| `active` | Employed, no exit planned | Default on create |
| `on_notice` | Resigned or given notice; still employed and paid until the last working day | HR records an exit |
| `exited` | Last working day has passed | **Derived automatically** from the date; no manual step or scheduled job |

**Recording an exit:** HR enters:
- **exit type**: `resigned` or `terminated`
- **resignation / notice date**
- **last working day**
- **note** (required)

The **notice period (days)** is shown as last working day − notice date.

**Withdrawing a resignation:** while the employee is `on_notice`, HR can withdraw it (note required), which returns them to `active`.

**Validation:** hire date ≤ notice date ≤ last working day. Exited employees are read-only except for corrections, which need a note.

**In other features:**
- `active` and `on_notice` employees count as **current headcount** in insights, because both are still on payroll.
- Slips can be generated for any month up to and including the month of the last working day.
- Every lifecycle change is recorded in the change history (F7).

### 4.4 F4: Pay insights (concrete questions HR can answer)
All figures are computed in SQL. Users can filter by country and department and choose a reporting currency (default **INR**). Only current headcount is counted (`active` and `on_notice`).

| # | Question | Output |
|---|---|---|
| Q1 | How many people do we employ and what do we spend on salaries in total? | Headcount, total annual payroll, average and median salary (reporting currency) |
| Q2 | How does pay compare across countries? | Per country: headcount, min / median / average / max, in local currency **and** reporting currency |
| Q3 | Which departments cost the most, and how does pay vary between them? | Per department: headcount, total payroll, median, average (reporting currency) |
| Q4 | What is the pay range for a given job title in a given country? | Per job title × country: headcount, min / median / max (local currency) |
| Q5 | Who is paid well outside the range of their peers? | Employees whose salary is < 80% or > 120% of the median for their job title × country; thresholds adjustable |
| Q6 | What pay and title changes happened recently, and why? | Change events in a date range, filterable by change type (e.g. promotions), with old → new title and % salary change |
| Q7 | Who is leaving, and what payroll walks out with them? | Employees `on_notice`, with last working day, grouped by department and country, and total annual salary (reporting currency) |

We deliberately don't compare a job title *across* countries in local currency, because medians in different currencies can't be compared. Cross-country comparison always goes through the reporting currency (Q2, Q3).

### 4.5 F5: Multi-currency comparison
- Each employee is paid in the **local currency of their country** (one country per employee). Salaries are stored in that currency and are **never converted on write**.
- An **exchange-rate table** holds one rate per currency, expressed as **INR per 1 unit** (e.g. USD = 83.20, EUR = 90.10, INR = 1), with an "as of" date and who last updated it. HR can edit the rates. The seed script loads a fixed snapshot.
- Converting between any two currencies goes through INR: `amount × rate[from] ÷ rate[to]`. Results are rounded to 2 decimals only at the end.
- **Reporting currency** is selectable in insights, the list and exports. The default is **INR**.
- Insights (Q1–Q3, Q7) and the employee list's "Annual salary (reporting currency)" column use the converted value. **Sorting the list by salary sorts by the converted value**, because sorting raw amounts in mixed currencies is meaningless.
- Every converted figure in the UI shows the rates' "as of" date, so HR knows it is a snapshot.

### 4.6 F6: Monthly salary slip (gross pay only)
- HR picks an employee and a month (`YYYY-MM`). The system builds the slip on demand from the salary and job title **in effect on the last day of that month** (taken from the change history).
- **Contents:** employee code, name, job title, department, country, month, currency, status (and last working day, if on notice or exited).
  - **Earnings (monthly):** base salary (annual base ÷ 12), allowances (annual allowances ÷ 12), **gross pay**.
  - **No deductions or net pay.** Real deductions depend on country tax brackets and personal factors. A flat estimate would be misleading, so the slip states *"Gross pay only — statutory deductions are not calculated."*
- A slip can only be generated for a month in which the employee was employed: hire date ≤ month end, and last working day (if any) ≥ month start.
- Output is a printable HTML view plus a **Download PDF** button. Slips are not stored, because they can always be rebuilt from history.

### 4.7 F7: Change history and audit
- Every change to **base salary, allowances, job title, department, or lifecycle (status / exit dates)**, whether from the UI or an import, appends an immutable history entry with:
  - **who, when**
  - **field(s) changed with old → new values**
  - **effective date, change type, note**
  - **source** (`ui` / `import` / `seed`)
- The employee detail page shows this timeline newest-first. Promotions show as title change plus salary change in one event.
- The history is what makes past-month slips correct (§4.6) and powers Q6.
- History rows are never updated or deleted, including through the API.
- Other edits (name, email typo fixes) update `updated_at` only and are not audited.

### 4.8 F8: Import and export
**Import (CSV only, runs in the background):**
1. **Template download:** a CSV with the header row (employee code, first name, last name, email, job title, department, country, hire date, base salary, allowances) and **3 example rows** showing valid values and formats, e.g. dates as `YYYY-MM-DD` and amounts without currency symbols or thousands separators.
   - Example rows use codes `EXAMPLE-1` to `EXAMPLE-3`. If they are left in an upload, the importer **rejects** them with the message *"example row — replace or delete"*, so they can never be imported by accident.
   - Excel users edit the template and use "Save As → CSV (UTF-8)".
2. **Upload checks (immediate, before queueing).** The upload is refused straight away, with a clear message, if:
   - the file isn't `.csv` / `text/csv`
   - it is **> 5 MB**
   - its header doesn't match the template
   - it has **0 rows or > 20,000 rows**
   - the import form is missing the **change type, effective date or note**. These apply to every change in the file, e.g. *"FY26 annual review"*.
   - **another import is already in progress**, meaning queued, validating, waiting in preview, or applying. The API returns `409 Conflict` with a link to that import, and nothing is queued.
3. **Queued for validation:** on success the API returns an **import job ID** at once (`202 Accepted`). Validation runs in the background queue (F9), and HR can leave the page.
4. **Preview (validation only, nothing saved):**
   - Every row is validated: field rules as in §4.2, duplicate codes or emails inside the file, and conflicts with existing employees.
   - The job then waits in `awaiting_confirmation` and shows a **preview**:
     - counts: **total, valid (to create / to update / unchanged), rejected**
     - a table of rejected rows with row number, employee code and **reason(s)**
     - a **"Download rejected rows" CSV**: the original columns plus an `error` column
   - Rows that are identical to the current data are counted as *unchanged* and will create no history entry.
5. **Decision:** HR chooses **"Import valid rows"** or **"Cancel"**.
   - **Cancel:** the job becomes `cancelled`. **No employee, history or audit data is written.** The staged rows are kept only for the report.
   - **Import valid rows:** the job is queued for the apply step.
6. **Apply (background):**
   - Each valid row is upserted by `employee_code` in **its own transaction**, so a failure in one row never rolls back the others.
   - Each row is **re-validated at apply time**, because data may have changed since the preview. A row that now fails is moved to rejected with its reason.
   - Every salary, title, department or lifecycle change creates a change-history entry with `source = import`, using the import's change type, effective date and note.
7. **Final report:** totals **created, updated, unchanged, rejected**, plus the rejected-rows CSV. HR fixes the rejected rows and **re-uploads just that file**. This is safe because import upserts by employee code.
8. **Import history:** a list of past imports with status, who uploaded each one, when, and its counts.
9. **Concurrency: one active import at a time, across all HR users.**
   - A new upload is refused while another import is queued, validating, waiting in preview, or applying.
   - This is enforced by a database constraint, so two uploads at the same moment can't both get through.
   - This means a preview can never be built on data that another import is about to change, and two imports can never race on the same employees.
   - Any HR user can open the pending import and **cancel** it, so a forgotten preview can't block imports indefinitely.

Lifecycle changes (resignations) are done in the UI, not by import.

**Export (CSV, Excel, PDF):**
- HR exports the **current filtered list** (same filters, sort and reporting currency as the UI) and picks the format:
  | Format | Notes |
  |---|---|
  | **CSV** | Same columns as the import template plus status, last working day and reporting-currency salary. Streamed. |
  | **Excel (.xlsx)** | Same columns, typed cells (numbers and dates, not text), header row frozen, one sheet. Streamed. |
  | **PDF** | Landscape table with title, filters applied, generation timestamp, rates "as of" date and page numbers. See the size rule below. |
- **PDF size rule:**
  - **≤ 1,000 rows:** downloaded directly.
  - **> 1,000 rows:** the UI tells HR the file is too large to download directly and that it will be **emailed to their own account address**. **There is no recipient field**: the email always goes to the logged-in user's address, so it can't be mistyped or sent elsewhere. The API returns an **export job ID** (`202 Accepted`), and the PDF is generated in the background queue (F9).
  - **Email delivery:** the email contains a **download link, not the file as an attachment**, and no salary data in the body. The link:
    - requires an HR login, and **works only for the user who requested the export**. Anyone else gets `403`, even another HR user.
    - **expires after 24 hours**, after which it returns `410 Gone`.
  - **File deletion:** when the link expires, the generated file is **deleted**. A cleanup job is scheduled for the expiry time when the file is created.
  - The export also appears on the requester's job status page with the same download link and the same rules.
- **Formula-injection guard:** in CSV and Excel output, any cell starting with `= + - @` is escaped.
- **Audit:** every export writes an audit entry recording who exported, the format, the filters and the row count. **Every download of an emailed export** is also recorded (who, when, which export), and so are refused download attempts.

### 4.9 F9: Background jobs
- Import and large-export jobs run in a **persistent queue stored in PostgreSQL**, so no extra infrastructure (Redis, etc.) is needed and jobs survive an API restart.
- **Job lifecycle:** `queued → running → completed | failed`. Imports add two states: `awaiting_confirmation` (the preview is ready) and `cancelled`.
  - A job interrupted by a crash or restart is retried automatically, up to 3 attempts.
- **Retries never repeat finished work:**
  - **Import validation:** writes nothing to employee data, so re-running it simply rebuilds the preview rows (replaced per row number).
  - **Import apply:** each row's **outcome is saved in the same transaction** as its employee and history changes. On retry, rows that already have a final outcome are **skipped**. A crash therefore never applies a row twice or creates duplicate history entries.
  - **Large PDF export:** the job records its progress on the export. If the file already exists, it isn't rebuilt. The email is **marked as sent before it is sent** (at most once). If sending fails with an error, the mark is cleared so a retry can try again. A retry therefore never emails the user twice. In the rare case of a hard crash mid-send, the email may be lost, but the download link is still on the job status page.
  - **Cleanup:** deleting an already-deleted file is a no-op.
- **Delayed jobs:** a job can be scheduled to run at a given time. This is used to delete export files at link expiry.
- **Job status page:** HR sees their jobs with type, status, progress (rows processed for imports), created and finished times, and links to the report or file. The UI polls for status while a job is running.
- **Email:** sent over SMTP using settings from environment variables. For local runs, a local mail catcher (e.g. Mailpit) is used, so no real email leaves the machine.

## 5. Out of scope (with reasoning)
| Item | Why it's out |
|---|---|
| Payroll processing, payouts, bank files | A different system with heavy compliance requirements; the brief is about *managing data* and *answering questions*. |
| Deductions, tax and net pay on slips | Real deductions depend on country tax brackets and personal circumstances. A flat estimate risks being taken as fact. Slips show gross only. |
| Hosting and deployment | Not required for this assessment. The app runs locally against the reviewer's own PostgreSQL. |
| Native `.xlsx` **import** | Import is CSV only, from the template (OQ8), which keeps one validation path. Export to Excel is in scope. |
| Salary files as email **attachments** | Once a file of everyone's salary is attached, it can be forwarded, stored on mail servers and read without any access control. Emails carry an expiring, login-protected link instead. |
| Live FX rates from an external API | Brings a network dependency, non-deterministic numbers and an API-key secret. HR-maintained rates are traceable and good enough for comparison. |
| Historical FX rates | Comparisons use one current snapshot. Point-in-time reporting would need a rate history table and isn't requested. |
| Emailing slips, employee self-service portal | The only persona is HR. Email is used only to deliver large export links. |
| Multiple roles / RBAC, approval workflows | There is a single persona. One role keeps the auth surface small. |
| SSO, MFA, password-reset emails | Few internal users. Accounts are managed by script. Noted as the first hardening step for production. |
| Bonus, equity, benefits, org hierarchy, performance reviews | Outside "salary". The change note captures feedback without building a review system. |
| Proration for mid-month joins, exits or salary changes | Slips use the salary in effect at month end. Proration is a payroll rule, not a data-management one. |
| Future-dated (scheduled) changes | Scheduling would split "current salary" from "stored salary" and add a job to apply changes. |
| Hard delete of employees | Audit and retention: exits keep history intact. |
| Gender / demographic fields and pay-equity analysis | Sensitive personal data that needs explicit employee **consent** and a consent-management process first. |
| Multi-tenant, i18n, mobile layout | One org, English UI, desktop browser use. |

## 6. Data model (fields)
Money is stored as `NUMERIC(14,2)` (never floating point) and amounts are **annual**. The exact schema is designed in Phase 2.

**Employee**
| Field | Notes |
|---|---|
| id | UUID |
| employee_code | unique, e.g. `EMP-00001`; the key for import upsert |
| first_name, last_name | |
| email | unique, work email |
| job_title | text |
| department | text |
| country_code | ISO 3166-1 alpha-2, must exist in Country |
| hire_date | date |
| base_salary | annual, in the country's currency |
| allowances | annual, in the country's currency, default 0 |
| exit_type | nullable: `resigned` \| `terminated` |
| notice_date | nullable: date resignation or notice was given |
| last_working_day | nullable; required when exit_type is set |
| status | derived: `active` / `on_notice` / `exited` (from exit fields and today's date) |
| version | integer, for optimistic locking |
| created_at, updated_at | timestamps |

**Change history** (append-only, the audit log)
| Field | Notes |
|---|---|
| id, employee_id | |
| changes | changed fields with old → new values (salary, allowances, job title, department, lifecycle) |
| base_salary, allowances, currency_code, job_title | snapshot of values in effect after this change, used for slip lookups |
| change_type | `hire`, `annual_review`, `promotion`, `market_adjustment`, `correction`, `exit`, `exit_withdrawn`, `other` |
| effective_date | ≤ today |
| note | required (appreciation, feedback or reason) |
| source | `ui` \| `import` \| `seed` |
| changed_by | HR user id |
| changed_at | timestamp |

**Export log:** `id`, `exported_by`, `format`, `filters`, `row_count`, `exported_at`.

**Export download log:** `export_id`, `user_id`, `outcome` (`downloaded` \| `forbidden` \| `expired`), `at`.

**Background job:** `id`, `type` (`import_validate` \| `import_apply` \| `export_pdf` \| `export_cleanup`), `status` (`queued` \| `running` \| `awaiting_confirmation` \| `completed` \| `cancelled` \| `failed`), `run_after`, `attempts`, `payload` (import file and form fields, or export filters), `progress`, `result` (import counts / file reference), `error`, `created_by`, `created_at`, `started_at`, `finished_at`.

**Import row:** `job_id`, `row_number`, `employee_code`, `outcome` (`valid` \| `rejected` at preview; `created` \| `updated` \| `unchanged` \| `rejected` after apply, written in the same transaction as the row's changes), `errors`, `raw_row` (the original values, for the rejected-rows CSV), `applied_at`.

**Export file:** `job_id`, `requested_by` (only this user may download), file content (deleted at expiry), `expires_at` (24 h), `email_sent_at` (guards against re-sending on retry), `deleted_at`.

**Country** (reference data, seeded): `code`, `name`, `currency_code` (ISO 4217).

**Exchange rate:** `currency_code`, `inr_per_unit`, `as_of`, `updated_by`.

**HR user:** `id`, `email` (unique), `name`, `password_hash`, `created_at`.

**Deliberately not stored (data minimisation):** date of birth, national ID, home address, bank details, gender.

## 7. Authentication and data privacy
- Passwords are hashed with a slow, salted algorithm (bcrypt or argon2) and never logged or returned.
- **Session:** a short-lived signed token (8 h) in an **httpOnly, SameSite=Strict** cookie; `Secure` is on wherever HTTPS is used. Nothing is stored in `localStorage`.
- Every endpoint except `/health` and `/auth/login` requires authentication.
- **Login rate limit:** 5 attempts per minute per IP and email. Failed logins return a generic message.
- **Logs:** request IDs, routes, status codes and timings only. No salary values, names, emails, change notes or request bodies.
- **CORS** is limited to the frontend origin, and security headers are set.
- **Data minimisation:** see §6. Exports are themselves audited (§4.8), because a file of everyone's salary is the biggest leak risk.
- **Emailed exports:**
  - Sent only to the requesting user's own account address; there is no recipient input.
  - A link only, with no attachment.
  - Downloading requires a login **and** being the requester.
  - The link expires in 24 h and the file is deleted at expiry.
  - Every download and every refused attempt is audited.
  - Email bodies contain no salary data.

## 8. Non-functional targets
| Area | Target |
|---|---|
| Data volume | 10,000 employees and their history; design headroom of 10× (100k) without schema changes |
| Users | ≤ 20 concurrent HR users (internal tool, not public traffic) |
| List / search API | p95 < 300 ms at 10k rows (indexed filters, `LIMIT/OFFSET` with max page size 100) |
| Insights API | p95 < 500 ms; aggregations in SQL |
| Slip (HTML / PDF) | p95 < 300 ms / < 1 s |
| CSV import | Upload checks respond in < 1 s. For 10,000 rows: preview ready in < 15 s, apply (one transaction per row) finishes in < 60 s |
| Export | CSV and Excel: 10,000 rows streamed in < 5 s. PDF: ≤ 1,000 rows directly in < 5 s; 10,000-row background PDF job in < 60 s |
| Job queue | A job is picked up within 5 s of being queued; one active import at a time |
| Seed | 10,000 deterministic employees in < 10 s (measured and documented) |
| Availability | Single local instance; `/health` endpoint checks the DB; graceful shutdown |
| Browsers | Latest Chrome, Edge, Firefox, Safari on desktop |

**What if there are many requests?** This is an internal tool, but it shouldn't fall over if a script or a stuck UI floods it:
- **Bounded work per request:** page size is capped at 100, import size is capped, direct PDF downloads are capped at 1,000 rows, and a request body size limit applies.
- **Heavy work off the request path:** imports and large PDFs go to the background queue. Requests return `202` with a job ID at once, so a burst of uploads queues up instead of tying up API workers or DB connections.
- **Bounded DB load:** a connection pool (about 10 connections) plus a DB statement timeout (5 s), so slow queries fail fast instead of piling up.
- **Streaming:** large CSV and Excel exports are streamed row by row instead of being built in memory.
- **Rate limits:** login as in §7, plus a general per-user API limit (300 requests/min) that returns `429` with `Retry-After`.
- **Scaling path:** the API is stateless (the session lives in a signed cookie), so it could run as several instances behind a load balancer. Insight results could be cached if measurements ever require it. No cache is planned now, because SQL aggregates over 10k rows take milliseconds.

## 9. Assumptions
1. Each employee belongs to exactly one country and is paid in that country's currency.
2. Salaries are stored as annual amounts; monthly = annual ÷ 12.
3. About 8 supported countries and currencies are seeded (e.g. IN, US, GB, DE, FR, SG, AU, CA). Adding a country is a data change, not a code change.
4. Exchange rates are updated manually by HR, occasionally (e.g. monthly).
5. HR users are few (≤ 20) and fully trusted with all salary data.
6. Job title and department are free text, trimmed. Filter dropdowns use their distinct values.
7. The existing Excel data can be mapped to the CSV template by HR before import.
8. All seed and demo data is synthetic. No real personal data is used.
9. The app runs locally. The reviewer provides PostgreSQL connection details in `.env`.
10. SMTP settings come from `.env`. For local runs a mail catcher (e.g. Mailpit) receives the emails.
11. Every HR user has a valid work email on their account, which is used for export emails.

## 10. Resolved questions
| # | Question | Decision |
|---|---|---|
| OQ1 | Slip deductions | Gross pay only, no deductions (D-009) |
| OQ2 | Audit non-salary changes? | Yes: job title, department and lifecycle too, since promotions drive pay (D-011) |
| OQ3 | Gender / demographic fields? | No; this would need employee consent first |
| OQ4 | Reporting currency | Selectable, default **INR** (D-010) |
| OQ5 | Import updates existing employees? | Yes, upsert by `employee_code` |
| OQ6 | Deployment target | None; deployment dropped (D-013) |
| OQ7 | Back-dated changes? | Yes, with a required note |
| OQ8 | `.xlsx` import? | No. CSV only, from a template with example rows; size and row limits; background job with an accepted/rejected report (D-015) |
| OQ9 | PDF export cap | Direct download for ≤ 1,000 rows; larger PDFs are generated by a background job and emailed (D-016) |
| OQ10 | Email attachment vs link | Link only, sent **only to the requester's own account address** with no recipient field, so no domain allowlist is needed. The link works only for the requester and expires in 24 h, the file is deleted at expiry, and every download is audited (D-018) |
| OQ11 | Partial vs all-or-nothing import | Partial, with a **preview step**: validate, show counts, then "Import valid rows" or "Cancel". One transaction per row; the rejected-rows CSV can be re-uploaded (D-019) |

## 11. Required acceptance tests (requested by the project owner)
These are written first (TDD) in Phase 3 and must stay green.
| # | Test |
|---|---|
| T1 | **Preview counts:** uploading a CSV with a known mix of rows (to create, to update, unchanged, invalid, example rows, in-file duplicates) produces exactly the expected valid / rejected / create / update / unchanged counts. |
| T2 | **Cancel saves nothing:** after a preview, cancelling leaves the employee, change-history and audit tables unchanged (row counts and contents compared before and after). |
| T3 | **Rejected-rows CSV:** the download contains the original header plus `error`, one line per rejected row with its original values and reason(s), and can be re-uploaded as-is after fixing. |
| T4 | **Download link rejects other users:** another authenticated HR user requesting the export gets `403`; the attempt is audited and no file is returned. |
| T5 | **Download link rejects expired links:** with an injected clock past `expires_at`, the requester gets `410`; the attempt is audited. |
| T6 | **File deleted at expiry:** running the cleanup job removes the file content and sets `deleted_at`. |
| T7 | **Import creates history:** a salary change applied by import writes a change-history entry with `source = import` and the import's note. |
| T8 | **Import retry skips finished rows:** an apply job that fails part-way (failure injected after N rows) and is then retried applies every row exactly once. Employee values are correct, each changed row has exactly one history entry, and rows done before the failure are not re-processed. |
| T9 | **Export retry doesn't re-send email:** an export job that fails after the email is sent and is then retried sends the email exactly once (fake mailer call count = 1). A job that fails *before* sending sends it exactly once on retry. |
| T10 | **One active import:** uploading while another import is queued, validating, in preview or applying returns `409` and queues nothing. After that import is cancelled or finished, a new upload is accepted. |

## 12. Open questions
None at the moment.
