# Requirements

## 1. Goal
Replace ACME's Excel-based salary tracking with a web application in which the HR Manager can:
1. Manage employee and salary records for about 10,000 employees across several countries, safely and with an audit trail.
2. Answer common questions about how the org pays people without building pivot tables.
3. Produce a monthly salary slip for any employee.
4. Move data in and out with CSV, because the existing data and habits live in Excel.

**Success:** the HR Manager can import the existing spreadsheet, find any employee in a few seconds, change a salary with a recorded reason, and answer the insight questions in §4.4 from one screen.

## 2. Persona
**HR Manager, ACME (primary and only user role)**
- Fluent in Excel: filters, sorts, pivots, VLOOKUP. Not technical.
- Today: one or more large workbooks, copy-pasting between sheets, manual currency conversion, no reliable history of who changed what.
- Pain points: slow lookups, accidental overwrites, no audit trail, cross-country comparisons done by hand, slips assembled manually.
- Needs: familiar table-style UI (filter, sort, search, export), numbers they can trust and trace, nothing that looks like payroll-engine complexity.

## 3. Scope at a glance
| # | Feature | In scope |
|---|---|---|
| F1 | Authentication (HR Manager login) | ✅ |
| F2 | Employee and salary CRUD with list, search, filter, sort, pagination | ✅ |
| F3 | Salary history and audit log | ✅ |
| F4 | Pay insights (fixed set of questions) | ✅ |
| F5 | Multi-currency comparison through a reporting currency | ✅ |
| F6 | Monthly salary slip (view and print) | ✅ |
| F7 | CSV import and export | ✅ |

## 4. In-scope features

### 4.1 F1: Authentication
- Email and password login for HR users. Accounts are created by a seed script or CLI; there is no self-signup.
- Every HR user has the same permissions (a single role).
- Session ends on logout or expiry.
- Details are in §7.

### 4.2 F2: Employee and salary management
- **List:** server-side pagination (default 25 rows, max 100), sorting, filters (country, department, job title, status) and free-text search (name, employee code, email).
- **Create / view / edit** an employee, including their salary.
- **Terminate** instead of deleting: set `status = terminated` and a `termination_date`. Records are never hard-deleted (see §5).
- **Salary edits** require an effective date and a reason. They are rejected if someone else edited the record in the meantime (optimistic locking), so two HR users can't silently overwrite each other.
- **Validation:** salary amounts must be > 0 with at most 2 decimals; country must be supported; email and employee code must be unique; termination date must be ≥ hire date. A salary change's effective date must be ≤ today and ≥ the effective date of the employee's latest salary change, so history stays in order.

### 4.3 F3: Salary history and audit
- Every salary change (create, edit, import) appends an immutable history entry: **who, when, old value, new value, effective date, reason, source** (UI or import).
- The employee detail page shows salary history newest-first.
- The history is also what makes past-month slips correct (§4.6).
- History rows are never updated or deleted, including through the API.

### 4.4 F4: Pay insights (concrete questions HR can answer)
All figures are computed in SQL. Users can filter by country and department and choose a reporting currency (default USD). Only active employees are counted.

| # | Question | Output |
|---|---|---|
| Q1 | How many people do we employ and what do we spend on salaries in total? | Headcount, total annual payroll, average and median salary (reporting currency) |
| Q2 | How does pay compare across countries? | Per country: headcount, min / median / average / max, in local currency **and** reporting currency |
| Q3 | Which departments cost the most, and how does pay vary between them? | Per department: headcount, total payroll, median, average (reporting currency) |
| Q4 | What is the pay range for a given job title in a given country? | Per job title × country: headcount, min / median / max (local currency) |
| Q5 | Who is paid well outside the range of their peers? | Employees whose salary is < 80% or > 120% of the median for their job title × country; thresholds adjustable |
| Q6 | What salary changes happened recently? | Latest salary changes in a date range, with % change |

We deliberately don't compare a job title *across* countries in local currency, because medians in different currencies can't be compared. Cross-country comparison always goes through the reporting currency (Q2, Q3).

### 4.5 F5: Multi-currency comparison
- Each employee is paid in the **local currency of their country** (one country per employee). Salaries are stored in that currency and are **never converted on write**.
- An **exchange-rate table** holds one rate per currency, expressed as units per 1 USD, with an "as of" date and who last updated it. HR can edit the rates. The seed script loads a fixed snapshot.
- Converting between any two currencies goes through USD: `amount / rate[from] × rate[to]`. Results are rounded to 2 decimals only at the end.
- Insights (Q1–Q3) and the employee list's "Annual salary (reporting currency)" column use the converted value. **Sorting the list by salary sorts by the converted value**, because sorting raw amounts in mixed currencies is meaningless.
- Every converted figure in the UI shows the rates' "as of" date, so HR knows it is a snapshot.

### 4.6 F6: Monthly salary slip
- HR picks an employee and a month (`YYYY-MM`). The system builds the slip on demand from the salary **in effect on the last day of that month** (taken from the salary history).
- **Contents:** employee code, name, job title, department, country, month, currency.
  - **Earnings (monthly):** base salary (annual base ÷ 12), allowances (annual allowances ÷ 12), gross.
  - **Deductions:** estimated deduction = gross × the country's flat deduction rate, labelled *"estimate — not a statutory tax calculation"*.
  - **Net pay:** gross − deductions.
- A slip can only be generated for a month in which the employee was employed: hire date ≤ month end, and no termination before the month starts.
- Output is a printable HTML view. HR uses the browser's "Print / Save as PDF". Slips are not stored, because they can always be rebuilt from the history.

### 4.7 F7: CSV import and export
- **Template:** a published CSV header (employee code, name, email, job title, department, country, hire date, status, base salary, allowances). The UI offers a template download. Excel users use "Save As → CSV (UTF-8)".
- **Import:**
  - Upload one CSV (≤ 5 MB, ≤ 20,000 rows) and validate **every row** before writing anything.
  - If any row is invalid, nothing is written and the response lists the errors with row numbers.
  - If every row is valid, all rows are written in **one transaction**: new employee codes are created, existing ones updated, and every salary change gets a history entry with `source = import`.
- **Export:** the **current filtered list** (same filters as the UI) is streamed as CSV with the same columns as the template, plus a reporting-currency column.
- **CSV injection guard:** any cell starting with `= + - @` is escaped on export.

## 5. Out of scope (with reasoning)
| Item | Why it's out |
|---|---|
| Payroll processing, payouts, bank files | A different system with heavy compliance requirements; the brief is about *managing data* and *answering questions*. |
| Statutory tax / social-security calculation per country | Legally complex and country-specific. A flat per-country estimate is enough for a breakdown, and the slip says clearly that it is an estimate. |
| Native `.xlsx` import/export | Adds a parser dependency and edge cases (formulas, merged cells, multiple sheets). Excel can save and open CSV natively. |
| Live FX rates from an external API | Brings a network dependency, non-deterministic numbers and an API-key secret. HR-maintained rates are traceable and good enough for comparison. |
| Historical FX rates | Comparisons use one current snapshot. Point-in-time reporting would need a rate history table and isn't requested. |
| Server-side PDF generation and stored slips | Browser print-to-PDF gives the same result with no dependency. Slips can be rebuilt from history, so there's nothing to store. |
| Emailing slips, employee self-service portal | The only persona is HR, and email means SMTP setup and handling PII outside the app. |
| Multiple roles / RBAC, approval workflows | There is a single persona. One role keeps the auth surface small. |
| SSO, MFA, password-reset emails | Few internal users. Accounts are managed by script. Noted as the first hardening step for production. |
| Bonus, equity, benefits, org hierarchy, performance reviews | Outside "salary". Each would widen the data model significantly. |
| Proration for mid-month joins, exits or salary changes | Slips use the salary in effect at month end. Proration is a payroll rule, not a data-management one. |
| Future-dated (scheduled) salary changes | The effective date must be ≤ today. Scheduling would split "current salary" from "stored salary" and add a job to apply changes. |
| Hard delete of employees | Audit and retention: termination keeps history intact. |
| Gender / demographic fields and pay-equity analysis | Sensitive personal data, which would need extra privacy controls. Listed as an open question. |
| Multi-tenant, i18n, mobile layout | One org, English UI, desktop browser use. |

## 6. Data model (fields)
Money is stored as `NUMERIC(14,2)` (never floating point) and amounts are **annual**.

**Employee**
| Field | Notes |
|---|---|
| id | UUID |
| employee_code | unique, e.g. `EMP-00001`; the key for CSV import |
| first_name, last_name | |
| email | unique, work email |
| job_title | text |
| department | text |
| country_code | ISO 3166-1 alpha-2, must exist in Country |
| hire_date | date |
| status | `active` \| `terminated` |
| termination_date | nullable; required when terminated |
| base_salary | annual, in the country's currency |
| allowances | annual, in the country's currency, default 0 |
| version | integer, for optimistic locking |
| created_at, updated_at | timestamps |

**Salary history** (append-only, which also makes it the audit log for salary)
| Field | Notes |
|---|---|
| id, employee_id | |
| old_base_salary, new_base_salary | old is null on creation |
| old_allowances, new_allowances | |
| currency_code | currency at the time of the change |
| effective_date | ≤ today |
| reason | required for edits |
| source | `ui` \| `import` \| `seed` |
| changed_by | HR user id |
| changed_at | timestamp |

**Country** (reference data, seeded): `code`, `name`, `currency_code` (ISO 4217), `deduction_rate` (0–1, used for the slip estimate).

**Exchange rate**: `currency_code`, `units_per_usd`, `as_of`, `updated_by`.

**HR user**: `id`, `email` (unique), `name`, `password_hash`, `created_at`.

**Deliberately not stored (data minimisation):** date of birth, national ID, home address, bank details, gender.

## 7. Authentication and data privacy
- Passwords are hashed with a slow, salted algorithm (bcrypt or argon2) and never logged or returned.
- **Session:** a short-lived signed token (8 h) in an **httpOnly, Secure, SameSite=Strict** cookie. Nothing is stored in `localStorage`.
- Every endpoint except `/health` and `/auth/login` requires authentication.
- **Login rate limit:** 5 attempts per minute per IP and email. Failed logins return a generic message.
- **Logs:** request IDs, routes, status codes and timings only. No salary values, names, emails or request bodies.
- **Transport and storage:** HTTPS in the deployed environment; encryption at rest is handled by the managed PostgreSQL provider.
- **CORS** is limited to the frontend origin, and security headers are set.
- **Data minimisation:** see §6. The audit trail records who changed which salary.

## 8. Non-functional targets
| Area | Target |
|---|---|
| Data volume | 10,000 employees and their history; design headroom of 10× (100k) without schema changes |
| Users | ≤ 20 concurrent HR users (internal tool, not public traffic) |
| List / search API | p95 < 300 ms at 10k rows (indexed filters, `LIMIT/OFFSET` with max page size 100) |
| Insights API | p95 < 500 ms; aggregations in SQL |
| Slip API | p95 < 300 ms |
| CSV import | 10,000 rows validated and written in < 10 s |
| CSV export | 10,000 rows streamed in < 3 s |
| Seed | 10,000 deterministic employees in < 10 s (measured and documented) |
| Availability | Single instance; `/health` endpoint checks the DB; graceful shutdown |
| Browsers | Latest Chrome, Edge, Firefox, Safari on desktop |

**What if there are many requests?** This is an internal tool, but it shouldn't fall over if a script or a stuck UI floods it:
- **Bounded work per request:** page size is capped at 100, the CSV size is capped, and a request body size limit applies.
- **Bounded DB load:** a connection pool (about 10 connections) plus a DB statement timeout (5 s), so slow queries fail fast instead of piling up.
- **Rate limits:** login as in §7, plus a general per-user API limit (300 requests/min) that returns `429` with `Retry-After`.
- **Scaling path:** the API is stateless (the session lives in a signed cookie), so it can run as several instances behind a load balancer. Insight results could be cached if measurements ever require it. No cache is planned now, because SQL aggregates over 10k rows take milliseconds.

## 9. Assumptions
1. Each employee belongs to exactly one country and is paid in that country's currency.
2. Salaries are stored as annual amounts; monthly = annual ÷ 12.
3. About 8 supported countries and currencies are seeded (e.g. US, GB, DE, FR, IN, SG, AU, CA). Adding a country is a data change, not a code change.
4. Exchange rates are updated manually by HR, occasionally (e.g. monthly).
5. HR users are few (≤ 20) and fully trusted with all salary data.
6. Job title and department are free text, trimmed. Filter dropdowns use their distinct values.
7. The existing Excel data can be mapped to the CSV template by HR before import.
8. All seed and demo data is synthetic. No real personal data is used.
9. Deployment is a single app container plus managed PostgreSQL. The provider is decided in Phase 2.

## 10. Open questions (each has a default so work can continue)
| # | Question | Proposed default |
|---|---|---|
| OQ1 | How should slip deductions work: a flat per-country estimate, per-employee manual deduction amounts, or no deductions? | Flat per-country estimate, clearly labelled |
| OQ2 | Should non-salary changes (job title, department, status) also be fully audited (old → new)? | No. Only salary is audited, as the brief asks; other edits update `updated_at` only |
| OQ3 | Do we need gender or other demographic fields for pay-equity questions? | No (privacy, data minimisation) |
| OQ4 | Should the reporting currency be fixed to USD, or selectable per view? | Selectable in insights and the list (it is just a query parameter); default USD |
| OQ5 | CSV import: should existing employee codes be updated (upsert), or only new codes created? | Upsert by `employee_code`, all-or-nothing |
| OQ6 | Do you have a preferred deployment target for the live URL (e.g. Render, Railway, Fly.io)? | Decide in Phase 2 |
| OQ7 | Should salary changes allow back-dated effective dates (e.g. a raise effective last month)? | Yes, but not future dates |
