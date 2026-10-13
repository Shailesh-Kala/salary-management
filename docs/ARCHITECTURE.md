# Architecture

This document turns [REQUIREMENTS.md](REQUIREMENTS.md) into a design. Decision references (D-xxx) point to [DECISIONS.md](DECISIONS.md).

## 1. Overview
- **One Node.js process** serves the JSON API and runs the background job worker. **One PostgreSQL database** holds all data, including the job queue and generated files.
- **The React single-page app** is served by Vite in development and talks to the API on the same origin, through the Vite proxy.
- **No other infrastructure.** SMTP is the only external dependency, and it is used only for large-export emails (a Mailtrap Sandbox or Mailpit test inbox locally).

### 1.1 Architecture diagram
```mermaid
flowchart LR
  subgraph Browser
    SPA["React + MUI SPA<br/>(Vite, TanStack Query, MUI X DataGrid)"]
  end

  subgraph API["Node.js 24 process (Express 5)"]
    direction TB
    MW["Middleware<br/>request ID · pino logger · helmet · CORS<br/>rate limit · auth · body limits"]
    RT["Routes / controllers<br/>(zod-validated input)"]
    SV["Services<br/>(business rules — pure, injected deps)"]
    RP["Repositories<br/>(parameterised SQL)"]
    WK["Job worker<br/>(polls jobs table, SKIP LOCKED)"]
    EH["Central error handler<br/>{ error: { code, message, details, requestId } }"]
    MW --> RT --> SV --> RP
    WK --> SV
    RT -.errors.-> EH
  end

  PG[("PostgreSQL 14+<br/>employees · employee_changes · imports<br/>import_rows · exports · jobs · …")]
  SMTP["SMTP<br/>(Mailtrap Sandbox / Mailpit locally)"]

  SPA -- "JSON over HTTP(S)<br/>httpOnly session cookie" --> MW
  RP -- "pg pool (10 conns, 5 s statement timeout)" --> PG
  SV -- "export-ready email (link only)" --> SMTP
```

### 1.2 Layering rules
| Layer | Knows about | Never does |
|---|---|---|
| **Routes** | HTTP: parse and validate input (zod), call one service method, shape the response | Business rules, SQL |
| **Services** | Business rules. They receive their dependencies (repositories, `clock`, `mailer`) as arguments | `req`/`res`, SQL, `Date.now()`, `Math.random()` |
| **Repositories** | SQL through `pg` with `$1` parameters, returning plain typed objects | Business decisions |

- Services are unit-tested with in-memory fake repositories and a fixed clock. Repositories and routes are integration-tested against a real test database (§8.3).
- Multi-step writes go through a `withTransaction(fn)` helper. The repositories used inside `fn` share that transaction's client.

### 1.3 Key flows

**Import: upload → preview → confirm/cancel → apply** (D-015, D-019, D-020, D-021)
```mermaid
stateDiagram-v2
  [*] --> validating: POST /imports (sync checks pass, 202)
  validating --> awaiting_confirmation: validate job done (schedules import_expire at +24 h)
  validating --> cancelled: POST /imports/:id/cancel
  awaiting_confirmation --> applying: POST /imports/:id/confirm
  awaiting_confirmation --> cancelled: POST /imports/:id/cancel
  awaiting_confirmation --> expired: 24 h passed (import_expire job)
  applying --> completed: all rows have a final outcome
  validating --> failed: 3 attempts exhausted
  applying --> failed: 3 attempts exhausted
  completed --> [*]
  cancelled --> [*]
  failed --> [*]
  expired --> [*]
```
- **Active** states are `validating`, `awaiting_confirmation` and `applying`. At most **one** import can be active, enforced by a partial unique index (D-021).
- **Preview expiry (D-031):**
  - When the preview is ready, `preview_expires_at = now + 24 h` and an `import_expire` job is scheduled for that time.
  - The job moves a still-`awaiting_confirmation` import to `expired`; otherwise it does nothing.
  - `confirm` also checks `now ≥ preview_expires_at` itself and returns `410`, so expiry never depends on when the job happens to run.
- **End-of-import clearing (D-031):** the transaction that moves an import to `completed`, `cancelled`, `failed` or `expired` also sets `imports.file = NULL` and `import_rows.raw = NULL`.
- **Apply** loops over rows that are valid in the preview and have `applied_at IS NULL`, in `row_number` order. **Each row runs in one transaction:**
  1. lock (`SELECT … FOR UPDATE`) or look up the employee
  2. re-validate the row with the **row rules** (REQUIREMENTS §4.8), the same pure function the preview uses
  3. upsert the employee
  4. insert the `employee_changes` row if needed (`hire` for new employees, effective on their hire date; the import's type and date otherwise; `relocation` for country changes), with `import_id` and `import_row_number`
  5. set `import_rows.outcome` and `applied_at`
  6. commit

  On retry, rows that already have `applied_at` are skipped. As a second guard, a unique index on `employee_changes (import_id, import_row_number)` makes a duplicate history row impossible (D-020).
- **Error isolation per row (D-037):** the row's transaction is wrapped in `try/catch`.
  ```ts
  try { await applyRowInTx(row) }
  catch (err) {
    if (isInfrastructureError(err)) throw err          // job fails → retried, finished rows skipped
    await markRowRejected(row, 'unexpected error — row not imported', ref)  // own tx
    log.error({ jobId, rowNumber, code: err.code })   // no row data
  }
  ```
  `isInfrastructureError` is a pure, unit-tested classifier. It matches:
  - SQLSTATE classes `08` (connection), `53` (insufficient resources) and `57P` (shutdown / cancelled)
  - `40001` (serialisation failure) and `40P01` (deadlock)
  - Node socket errors (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`) and the pg "connection terminated" error

  Everything else is a row problem. The validate step uses the same wrapper.

**Large PDF export by email** (D-016, D-018, D-020)
```mermaid
sequenceDiagram
  participant UI
  participant API
  participant DB as PostgreSQL
  participant W as Worker
  participant M as SMTP
  UI->>API: POST /exports/employees/email {filters}
  API->>DB: tx: insert exports row (status=queued) + jobs(export_pdf)
  API-->>UI: 202 {exportId}
  W->>DB: claim job (FOR UPDATE SKIP LOCKED)
  alt file not yet built
    W->>DB: tx: save PDF bytes, expires_at = now+24h, enqueue export_cleanup(run_after=expires_at)
  end
  W->>DB: UPDATE exports SET email_sent_at=now WHERE email_sent_at IS NULL RETURNING id
  alt row returned (not sent before)
    W->>M: send link APP_BASE_URL/exports/:id to requester's own address
    Note over W,M: on send error → clear email_sent_at, throw → retry
  end
  Note over UI: HR clicks the link in webmail → top-level navigation to the SPA page /exports/:id<br/>(the cookie may be withheld on this cross-site navigation — the HTML needs no auth)
  UI->>API: GET /api/auth/me (same-site fetch → cookie sent)
  alt 401
    UI->>UI: redirect /login?next=/exports/:id → back after login
  end
  UI->>API: GET /api/exports/:id/download (fetch, credentials: include)
  API->>DB: requester? not expired? → audit outcome
  API-->>UI: 200 PDF blob → saved via object URL | 403 | 410 → message
```
- **Why a page and not an API link (D-032):** the session cookie is `SameSite=Strict`, so a direct `/api/...` link clicked from Gmail or Outlook web arrives cross-site without the cookie and gets `401`. The SPA page's own `fetch` is same-site, so the cookie is sent.
- **Return after login:** `next` is accepted only if it is a relative path starting with a single `/`. Anything else falls back to `/`, so the parameter can't be used as an open redirect.

## 2. Tech stack
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24.21.0 | Runs `.ts` directly with native type stripping, so no build step for the server. `tsconfig`: `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`, `strict` (D-022) |
| HTTP | Express 5 | Async errors reach the error handler natively; works with Supertest (D-023) |
| DB access | `pg` + hand-written parameterised SQL | No ORM; aggregations need `percentile_cont`, `FILTER` and window functions (D-024) |
| Migrations | `node-pg-migrate` with **SQL** migration files | Up/down migrations, run with `npm run migrate` |
| Validation | `zod` | Request bodies, query strings, env config and CSV rows share one library |
| Auth | Node `crypto.scrypt` for passwords; `jose` for the HS256 session JWT | No native modules (D-025) |
| Security middleware | `helmet`, `cors`, `express-rate-limit`, `cookie-parser` | |
| Logging | `pino` + `pino-http` | JSON logs, request ID, redaction |
| CSV | `csv-parse`, `csv-stringify` | Streaming |
| Excel | `exceljs` (streaming `WorkbookWriter`) | Export only |
| PDF | `pdfkit` | Slips and list export |
| Email | `nodemailer` (SMTP, optional auth) | Mailtrap Sandbox or Mailpit locally; a fake mailer in tests |
| Uploads | `multer` (memory storage, 5 MB limit) | CSV only |
| Frontend | React 19, Vite, TypeScript, MUI, MUI X DataGrid (server mode), React Router, TanStack Query | D-026 |
| Tests | Vitest, Supertest, React Testing Library | Real PostgreSQL test DB (D-027) |
| Lint / format | ESLint (typescript-eslint) + Prettier | Run in CI |
| Database | PostgreSQL 14 or newer (developed on 14.3, CI on 16) | Uses only features available since 13–14 (`gen_random_uuid`, `SKIP LOCKED`, `percentile_cont`, partial indexes) |
| CI | GitHub Actions with a `postgres:16` service | lint → typecheck → test |

## 3. Data model
Money is `NUMERIC(14,2)`; rates are `NUMERIC(18,6)`; all amounts are annual. Timestamps are `timestamptz`. IDs are `uuid` (`gen_random_uuid()`), except the append-only logs, which use `bigint identity`.

```mermaid
erDiagram
  hr_users ||--o{ employee_changes : "changed_by"
  hr_users ||--o{ imports : "uploaded_by"
  hr_users ||--o{ exports : "requested_by"
  countries ||--o{ employees : "country_code"
  exchange_rates ||--o{ countries : "currency_code"
  employees ||--o{ employee_changes : ""
  imports ||--o{ import_rows : ""
  imports ||--o{ employee_changes : "import_id"
  exports ||--o{ export_downloads : ""
  exchange_rates ||--o{ exchange_rate_changes : ""
```

### 3.1 Tables
**`hr_users`**: `id`, `email` (unique, stored lower-case), `name`, `password_hash` (`scrypt$N$r$p$salt$hash`), `token_version int NOT NULL DEFAULT 1`, `disabled_at timestamptz NULL`, `created_at`.

**`countries`**: `code char(2) PK`, `name`, `currency_code char(3) FK → exchange_rates`.

**`exchange_rates`**: `currency_code char(3) PK`, `inr_per_unit numeric(18,6) CHECK > 0`, `as_of date`, `updated_by FK`, `updated_at`. INR's row is fixed at 1.

**`exchange_rate_changes`** (append-only, same trigger as `employee_changes`): `id`, `currency_code`, `old_inr_per_unit`, `new_inr_per_unit`, `old_as_of`, `new_as_of`, `changed_by`, `changed_at`. Written in the same transaction as the rate update.

**`employees`**
| Column | Type / constraint |
|---|---|
| id | uuid PK |
| employee_code | text UNIQUE NOT NULL |
| first_name, last_name | text NOT NULL |
| email | text UNIQUE NOT NULL (lower-case) |
| job_title, department | text NOT NULL (trimmed) |
| country_code | char(2) FK → countries; changed only by a `relocation` change event |
| hire_date | date NOT NULL |
| base_salary | numeric(14,2) CHECK > 0 |
| allowances | numeric(14,2) NOT NULL DEFAULT 0 CHECK ≥ 0 |
| exit_type | text NULL CHECK in (`resigned`,`terminated`) |
| notice_date, last_working_day | date NULL |
| version | int NOT NULL DEFAULT 1 (optimistic locking) |
| created_at, updated_at | timestamptz |

- **Checks:** the exit fields are all NULL or all set; `hire_date ≤ notice_date ≤ last_working_day`.
- **Indexes:** `country_code`, `department`, `job_title`, `last_working_day`, `(last_name, first_name)`, and a GIN `pg_trgm` index on `lower(first_name ‖ ' ' ‖ last_name ‖ ' ' ‖ email ‖ ' ' ‖ employee_code)` for search.
- **Status is not stored** (D-014). It is computed by one shared SQL expression whose `today` is passed in as a parameter from the injected clock:
  ```sql
  CASE WHEN last_working_day IS NULL THEN 'active'
       WHEN last_working_day >= $today THEN 'on_notice'
       ELSE 'exited' END
  ```
- **Annual salary** in comparisons, insights, sorting and exports means **base_salary + allowances** (annual gross). Base and allowances are also shown separately (D-028).

**`employee_changes`** (append-only audit and history, D-011)
| Column | Type / constraint |
|---|---|
| id | bigint identity PK |
| employee_id | uuid FK |
| change_type | text CHECK in (`hire`,`annual_review`,`promotion`,`market_adjustment`,`relocation`,`correction`,`exit`,`exit_withdrawn`,`other`) |
| effective_date | date NOT NULL |
| note | text NOT NULL (5–1000 chars) |
| source | text CHECK in (`ui`,`import`,`seed`) |
| changes | jsonb: `{ field: { old, new } }`, only the fields that changed |
| base_salary, allowances, currency_code, country_code, job_title, department | snapshot of values **after** this change; slips read currency and country from here, so pre-relocation slips keep the old currency |
| changed_by | uuid FK → hr_users |
| import_id, import_row_number | NULL unless `source = import`; UNIQUE together (retry guard) |
| changed_at | timestamptz |

- **Indexes:** `(employee_id, effective_date DESC, id DESC)` for the timeline and slip lookups; `(changed_at)` for Q6.
- **Immutability:** a `BEFORE UPDATE OR DELETE` trigger raises an exception, so even a buggy repository can't rewrite history.

**`imports`**
| Column | Notes |
|---|---|
| id, uploaded_by, file_name | |
| status | `validating` \| `awaiting_confirmation` \| `applying` \| `completed` \| `cancelled` \| `expired` \| `failed` |
| preview_expires_at | set when the preview becomes ready (+24 h) |
| change_type, effective_date, note | applied to every change in the import |
| file | bytea; the raw CSV, cleared once the import is completed, cancelled or failed |
| counts | jsonb: `{ total, valid, toCreate, toUpdate, unchanged, rejected, created, updated }` |
| error | text, set when the import failed |
| created_at, finished_at | |

- **Partial unique index:** `CREATE UNIQUE INDEX one_active_import ON imports ((true)) WHERE status IN ('validating','awaiting_confirmation','applying')` (D-021).

**`import_rows`**: `(import_id, row_number) PK`, `employee_code`, `raw jsonb NULL` (set to NULL when the import ends), `preview_outcome` (`create` \| `update` \| `unchanged` \| `rejected`), `outcome` (`created` \| `updated` \| `unchanged` \| `rejected` \| NULL until applied), `errors jsonb`, `applied_at`.

**`exports`** (audit of **every** export, plus the stored file for emailed ones)
| Column | Notes |
|---|---|
| id, requested_by | only `requested_by` may download (D-018) |
| format | `csv` \| `xlsx` \| `pdf` |
| delivery | `direct` \| `email` |
| filters | jsonb: filters, sort and reporting currency used |
| row_count | |
| status | `completed` (direct) \| `queued` \| `ready` \| `failed` (email) |
| file | bytea NULL; set to NULL by cleanup |
| expires_at, email_sent_at, deleted_at, created_at | |

**`export_downloads`**: `id`, `export_id`, `user_id`, `outcome` (`downloaded` \| `forbidden` \| `expired`), `at`. Append-only, with the same trigger as `employee_changes`.

**`jobs`** (queue, D-017, D-030)
| Column | Notes |
|---|---|
| id | bigint identity |
| type | `import_validate` \| `import_apply` \| `import_expire` \| `export_pdf` \| `export_cleanup` |
| payload | jsonb, e.g. `{ importId }` / `{ exportId }` |
| status | `queued` \| `running` \| `completed` \| `failed` |
| attempts, max_attempts | default max 3 |
| run_after | timestamptz; used for delayed jobs (cleanup) and retry backoff |
| locked_until | lease; a `running` job whose lease has passed is considered crashed and can be re-claimed |
| last_error | text: error message only, never row data |
| created_at, updated_at | |

- **Index:** `(status, run_after)`.

### 3.2 Seed data
- **Countries and currencies:** IN/INR, US/USD, GB/GBP, DE/EUR, FR/EUR, SG/SGD, AU/AUD, CA/CAD, with a fixed rate snapshot (as of 2026-10-01). This is **reference data**, so it is loaded by migration `0001` through the SQL function `load_reference_data()`. Tests reuse the same function to restore it after emptying tables (D-041).
- **One HR user** from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- **10,000 employees** generated with a seeded PRNG (`mulberry32`, about 10 lines, no dependency) and built-in name, title and department lists. Salaries come from per-title USD bands × country pay level × the snapshot rate, rounded to 1,000 local units. Each employee gets a `hire` history row; leavers (~7%) also get an `exit` row. Dates are relative to `today`, so output is identical for the same seed on the same day (D-045).
- **Guard:** the seed refuses to run when employees exist; `--reset` truncates employees and history and restores the rate snapshot first.
- **Search index at this size:** for broad terms the planner prefers a ~19 ms sequential scan over the ~5 ms trigram scan (cost estimate); both are far inside the 300 ms target, and the index takes over as the table grows.
- Rows are inserted with multi-row `INSERT … SELECT * FROM unnest($1::text[], …)` in batches of 1,000, inside one transaction. Target < 10 s; measured **1.3–1.7 s** (README).

## 4. API
Base path `/api`. JSON in and out unless noted. **All routes except `GET /health` and `POST /api/auth/login` require the session cookie.**

**Error shape (all errors):**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable summary", "details": [{ "path": "baseSalary", "message": "Must be > 0" }], "requestId": "3f2c…" } }
```

**Error codes:**
| Code | Status |
|---|---|
| `VALIDATION_ERROR` | 400 |
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `VERSION_CONFLICT` | 409 |
| `DUPLICATE` | 409 |
| `IMPORT_IN_PROGRESS` | 409 |
| `INVALID_STATE` | 409 |
| `GONE` | 410 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `EXPORT_TOO_LARGE` | 422 |
| `RATE_LIMITED` | 429 |
| `INTERNAL` | 500 (message only, no stack in the response) |

### 4.1 Endpoints
| Method & path | Purpose | Notes |
|---|---|---|
| `GET /health` | Liveness and DB check | `200 {status:"ok", db:"ok"}` or `503` |
| **Auth** | | |
| `POST /api/auth/login` | Email + password → sets cookie | Rate limited (5/min per IP+email **and** 20/min per IP across all emails); generic failure message |
| `POST /api/auth/logout` | Increments `token_version` (ends all of this user's sessions) and clears the cookie | |
| `GET /api/auth/me` | Current user | |
| **Reference data** | | |
| `GET /api/countries` | Countries with currency | |
| `GET /api/exchange-rates` | All rates with `as_of` | |
| `PUT /api/exchange-rates/:currency` | Update one rate | `{inrPerUnit, asOf}`; INR is immutable; writes `exchange_rate_changes` in the same transaction |
| `GET /api/exchange-rates/history` | Rate change history | `currency` filter, newest first, paginated |
| `GET /api/employees/filter-options` | Distinct departments and job titles | For filter dropdowns |
| **Employees** | | |
| `GET /api/employees` | List | `page`, `pageSize` (≤100), `sort` (whitelist: `name`, `employeeCode`, `jobTitle`, `department`, `country`, `hireDate`, `annualSalary`), `order`, `q`, `country`, `department`, `jobTitle`, `status`, `currency` (default INR). Returns `{items, total, page, pageSize, ratesAsOf}` |
| `POST /api/employees` | Create | Writes the employee and a `hire` change in one transaction |
| `GET /api/employees/:id` | Detail | Includes `version` and the derived `status` |
| `PATCH /api/employees/:id` | Edit non-audited fields (name, email) | `{version, …}`; `409 VERSION_CONFLICT` on a stale version |
| `POST /api/employees/:id/changes` | Audited change event | `{version, changeType, effectiveDate, note, baseSalary?, allowances?, jobTitle?, department?, countryCode?}`; at least one field must actually change. `countryCode` is accepted **only** with `changeType = relocation`, and then `baseSalary` and `allowances` are required (D-033). `hireDate` is accepted **only** with `changeType = correction`, and must be ≤ the first non-hire change's effective date and ≤ `notice_date`. For exited employees, only `correction` is accepted (D-036) |
| `GET /api/employees/:id/changes` | History timeline | Newest first |
| `POST /api/employees/:id/exit` | Record resignation or termination | `{version, exitType, noticeDate, lastWorkingDay, note}` |
| `POST /api/employees/:id/exit/withdraw` | Withdraw while on notice | `{version, note}` |
| `GET /api/employees/:id/slips/:month` | Monthly slip | `month` = `YYYY-MM` and ≤ the current month (in `APP_TIMEZONE`). Uses the latest snapshot with `effective_date ≤ month end`; if a corrected (earlier) hire date makes the month precede every snapshot, it falls back to the earliest snapshot. `?format=pdf` returns a PDF |
| **Insights** (all take `country`, `department`, `currency`) | | |
| `GET /api/insights/summary` | Q1 | |
| `GET /api/insights/by-country` | Q2 | |
| `GET /api/insights/by-department` | Q3 | |
| `GET /api/insights/by-job-title` | Q4 | Requires `country` |
| `GET /api/insights/outliers` | Q5 | `low` (default 0.8), `high` (default 1.2), paginated |
| `GET /api/insights/recent-changes` | Q6 | `from`, `to`, `changeType`, paginated |
| `GET /api/insights/leavers` | Q7 | |
| **Imports** | | |
| `GET /api/imports/template` | CSV template with 3 `EXAMPLE-*` rows | |
| `POST /api/imports` | multipart: `file`, `changeType`, `effectiveDate`, `note` | Sync checks (§4.8 of the requirements); `202 {importId}`; `409 IMPORT_IN_PROGRESS` |
| `GET /api/imports` | Import history | Paginated |
| `GET /api/imports/:id` | Status, counts, first 100 rejected rows | Polled by the UI |
| `GET /api/imports/:id/rejected.csv` | Rejected rows plus an `error` column | |
| `POST /api/imports/:id/confirm` | `awaiting_confirmation` → `applying` | `410 GONE` if `now ≥ preview_expires_at` or the import is `expired`; `409 INVALID_STATE` for other states |
| `POST /api/imports/:id/cancel` | `validating` or `awaiting_confirmation` → `cancelled` | Any HR user |
| **Exports** | | |
| `GET /api/exports/employees` | Direct download | `format=csv\|xlsx\|pdf` plus the list filters. PDF with > 1,000 rows → `422 EXPORT_TOO_LARGE` (the UI then offers email) |
| `POST /api/exports/employees/email` | Queue a large PDF | List filters; `202 {exportId}`; sent to the requester's own email |
| `GET /api/exports` | My emailed exports and their status | |
| `GET /api/exports/:id/download` | Download an emailed export | Called by the SPA page `/exports/:id` with `fetch`, not linked directly. `403` if not the requester, `410` if expired or deleted; every attempt audited |

## 5. Folder structure
```
salary-management/
├─ package.json            # npm workspaces: server, web; root scripts lint / format / test
├─ eslint.config.js  .prettierrc  .nvmrc  .env.example
├─ .github/workflows/ci.yml
├─ docs/                   # REQUIREMENTS, ARCHITECTURE, PLAN, DECISIONS, PROMPTS
├─ server/
│  ├─ package.json  tsconfig.json  vitest.config.ts
│  ├─ migrations/          # 0001_init.sql, 0002_employees.sql, … (node-pg-migrate, SQL)
│  ├─ scripts/
│  │  ├─ seed.ts           # deterministic 10k seed, prints timing
│  │  └─ user.ts           # user:create -- <email> "<name>" | user:reset-password | user:disable | user:enable -- <email>
│  ├─ test/                # global-setup (migrate test DB), db reset, factories, fake mailer
│  └─ src/
│     ├─ main.ts           # wires real deps, starts HTTP + worker, graceful shutdown
│     ├─ app.ts            # createApp(deps) → Express app (no listen; used by Supertest)
│     ├─ config.ts         # zod-validated env
│     ├─ db/               # pool.ts, transaction.ts
│     ├─ lib/              # errors.ts, clock.ts, logger.ts, money.ts, prng.ts, csv-safe.ts
│     ├─ middleware/       # auth.ts, error-handler.ts, rate-limit.ts, validate.ts
│     ├─ jobs/             # queue.repository.ts, worker.ts (runOnce + loop)
│     └─ modules/
│        ├─ auth/          # auth.routes.ts, auth.service.ts, password.ts, users.repository.ts
│        ├─ employees/     # routes, service, repository, schemas, status.ts, changes.ts
│        ├─ rates/
│        ├─ insights/
│        ├─ slips/         # slip.ts (pure calc), slip-pdf.ts, routes
│        ├─ imports/       # template, upload checks, row-validator.ts, validate & apply handlers
│        └─ exports/       # csv/xlsx/pdf writers, email export handler, cleanup handler
│        # tests sit next to code: *.test.ts (unit) and *.int.test.ts (integration)
└─ web/
   ├─ package.json  vite.config.ts  index.html
   └─ src/
      ├─ main.tsx  App.tsx  theme.ts
      ├─ api/              # fetch client (credentials: include, error-shape parsing), query hooks
      ├─ components/       # shared UI (MoneyCell, StatusChip, ConfirmDialog, …)
      └─ pages/            # Login (?next=), Employees, EmployeeDetail, EmployeeForm, Slip,
                           # Insights, Imports, ImportDetail, Exports, ExportDownload (/exports/:id),
                           # ExchangeRates
```

## 6. Security decisions
| Decision | Trade-off |
|---|---|
| **Passwords:** `crypto.scrypt` (N=2¹⁵, r=8, p=1) with a random 16-byte salt; compared with `timingSafeEqual`. On an unknown email, a dummy hash is still computed so response timing doesn't reveal whether the account exists (D-025). | Uses the built-in KDF rather than argon2id. scrypt is memory-hard and widely accepted, and avoids native modules. |
| **Session:** HS256 JWT (`jose`) with `sub`, `tv` (token version) and `exp` = 8 h, in a cookie set `httpOnly; SameSite=Strict; Path=/`. `Secure` is controlled by `COOKIE_SECURE`: true by default, false in `.env.example` for http://localhost. | |
| **Revocation (D-038):** `requireAuth` verifies the JWT, then loads the user by primary key on **every request**. It rejects with `401` if `disabled_at IS NOT NULL` or `token_version ≠ tv`. Logout and `user:disable` increment `token_version`; disable also sets `disabled_at`. Login refuses disabled users with the generic message. | One indexed lookup per request (sub-millisecond). Logout ends the user's sessions on every device. |
| **CSRF:** the `SameSite=Strict` session cookie is what protects us. A cross-site form or request, including a multipart form post, is sent without the cookie, so it is unauthenticated. | No CSRF token. Relies on browsers enforcing SameSite, which all current browsers do. Side effect: links from outside the app (email) must land on an SPA page, not an API URL (D-032). |
| **Authorisation:** `requireAuth` is applied router-wide under `/api`; only login is exempt. Export downloads also check `requested_by = user.id`. | A single role (D-008), so there's no per-record ACL apart from exports. |
| **Input validation:** zod schemas on every body and query; sort fields come from a whitelist mapped to SQL column expressions; unknown fields are rejected. | |
| **SQL:** parameterised only (`$1…`). No string-built SQL except whitelisted identifiers from a fixed map. | Hand-written SQL needs care, so review and tests cover it. |
| **Rate limits:** login 5/min per IP+email (slows guessing one account) **and** 20/min per IP whatever the email (stops one IP spraying many accounts) (D-042); API 300/min per user (`express-rate-limit`, in-memory store). | An in-memory store is per process, which is fine for a single instance. A Redis store is the upgrade path if the app is ever scaled out. |
| **Headers and CORS:** `helmet` defaults (CSP, `X-Content-Type-Options`, `X-Frame-Options`, no `X-Powered-By`); HSTS only when `COOKIE_SECURE=true` (i.e. served over HTTPS). CORS reflects only `CORS_ORIGIN` (array form, so other origins get no CORS headers), with credentials. | |
| **Body limits:** JSON 100 kB; multipart 5 MB, one file, `.csv` / `text/csv` only. | |
| **Logging:** pino-http with custom serializers that log only `req: {id, method, path}` (path without the query string) and `res: {statusCode}`. Headers (cookies), query strings and bodies are never serialised; job errors log codes and messages only. A test captures real log output and checks no cookie, search term, salary, email or password appears. | Debugging data problems needs a DB query rather than log reading. That's the intended privacy trade. |
| **Audit:** `employee_changes` (who, what, old → new, when, note) and `export_downloads` are append-only, enforced by a DB trigger. Every export is recorded in `exports`. | Name and email edits aren't audited (D-011). |
| **Spreadsheet formula injection:** CSV and Excel cells starting with `= + - @ \t \r` are prefixed with `'`. | The value looks slightly different when opened in a text editor. |
| **Emailed exports:** sent only to the requester's address, with a link to the app page `/exports/:id` and no attachment. Downloading needs the same user's session, the link expires in 24 h, and the file is deleted by a delayed cleanup job (D-018, D-032). Login's `next` parameter only accepts relative paths. | A colleague can't receive an export. |
| **Rate audit:** every exchange-rate update writes old → new, who and when to the append-only `exchange_rate_changes`. | |
| **Import data minimisation:** the uploaded file and `import_rows.raw` are nulled when the import ends; previews expire after 24 h (D-031). | Rows rejected at apply time can't be downloaded as CSV after the import ends. |
| **Secrets:** env only (`DATABASE_URL`, `JWT_SECRET` ≥ 32 chars, `SMTP_*` including `SMTP_USER`/`SMTP_PASS`, `SEED_ADMIN_*`), validated at startup. `.env.example` is committed and `.env` is git-ignored. | |

## 7. Performance decisions
| Decision | Trade-off |
|---|---|
| **Server-side list:** `LIMIT/OFFSET` with `pageSize ≤ 100` and a stable `ORDER BY <col>, id`. One `count(*)` with the same filters. | OFFSET slows on deep pages at very large scale. At 10k–100k rows it takes milliseconds; keyset pagination is the upgrade path (D-029). |
| **Indexes:** B-tree on `country_code`, `department`, `job_title`, `last_working_day`, `(last_name, first_name)`; trigram GIN for `q`; `(employee_id, effective_date DESC, id DESC)` and `(changed_at)` on changes; `(status, run_after)` on jobs. | A little extra write cost, which is negligible for this workload. |
| **Reporting-currency sort:** `ORDER BY (base_salary + allowances) * r_from.inr_per_unit / r_to.inr_per_unit` through a join to `exchange_rates`. | Can't use an index (it's a computed value). Sorting 10k rows in memory takes about 5 ms; a generated column would go stale when rates change. |
| **Insights in SQL:** `count`, `sum`, `avg`, `percentile_cont(0.5) WITHIN GROUP`, `min`, `max`, `GROUP BY`. Outliers (Q5) use a CTE of medians per `(job_title, country)` joined back. Conversion is done inside the query; each salary is converted unrounded and only the final aggregates are rounded to 2 decimals. Amounts are returned as text. Measured Q1–Q3 on 10k seeded rows: 10–94 ms; Q4–Q5: 16–92 ms. Outlier peer medians use all current staff (filters only narrow who is listed), and outliers are ordered by `greatest(pay/median, median/pay)`, so ½× and 2× rank equally. | No caching; it's added only if measurements show a need. Medians go through `percentile_cont` (double precision), exact to the cent at these magnitudes. |
| **DB pool:** 10 connections; `statement_timeout = 5s` for API queries. The worker's import transactions are short (one row each), so they stay well under it. | A runaway query fails fast instead of piling up. |
| **Exports:** CSV and Excel stream rows in keyset-paged chunks of 1,000 from the DB straight into the HTTP response. PDF is built from at most 1,000 rows directly, or in the worker for larger exports. | Memory stays flat at about 1,000 rows. |
| **Import:** parse the whole file (≤ 5 MB) once in the validate job. Bulk-load existing employees by code and email in one query, so validation doesn't query the DB per row. Apply is one transaction per row (D-019). | Apply is slower than batched writes; the target is < 60 s for 10k rows, in the background. |
| **Seed:** `unnest` multi-row inserts, 1,000 rows per statement, in one transaction. | |
| **Frontend:** DataGrid in server mode for paging and sorting (filters are form controls above it); list state kept in the URL; search debounced by 300 ms; TanStack Query caching with `keepPreviousData` so the grid doesn't flash between pages; polling only while a job is active. Measured list API on 10k seeded rows: 13–59 ms. | Single JS bundle ~>500 kB (MUI + DataGrid); fine for an internal desktop tool, route-level code splitting is the upgrade path. |

## 8. Reliability decisions
| Decision | Trade-off |
|---|---|
| **Migrations:** versioned SQL files run with `node-pg-migrate`. CI and the test setup apply every migration to a fresh DB, so a broken migration fails the build. | Down migrations are written by hand. |
| **Transactions:** `withTransaction` for every multi-step write: create plus hire change; change event plus employee update; exit; import row; export plus job enqueue. | |
| **Optimistic locking:** every mutating employee request carries `version`, and the update uses `WHERE id = $1 AND version = $2`. Zero rows updated → `409 VERSION_CONFLICT`. The UI reloads and shows the newer data. | The user re-applies their change; there's no automatic merge. |
| **History ordering:** `effective_date` must be ≤ today and ≥ the latest change's `effective_date`. "Salary at a date" is then a single indexed lookup. | You can't insert a correction *between* two past changes. You record a new `correction` change instead. |
| **Job queue (D-030):** claimed with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, which sets `running`, increments `attempts` and sets `locked_until = now + 5 min`. A job that throws is re-queued with backoff (`run_after = now + attempts × 10 s`) until `max_attempts`, then marked failed (and its import/export is marked failed). A crashed worker's job is re-claimed once its lease expires. All time comparisons use the injected clock, passed as a SQL parameter. | Polling every 1 s adds up to 1 s of pickup latency. One worker loop processes jobs **serially**, so an import apply can delay an export by up to a minute, which is acceptable at this volume. |
| **Idempotent handlers (D-020):** apply skips rows that have `applied_at`; a unique index on `(import_id, import_row_number)` blocks duplicate history; the export skips rebuilding an existing file; `email_sent_at` is set at most once (claimed with `WHERE email_sent_at IS NULL`); cleanup is a no-op if already deleted. | A hard crash during the SMTP call can lose the email. The link is still on the Exports page. |
| **One active import:** a partial unique index; a unique violation maps to `409 IMPORT_IN_PROGRESS` (D-021). | |
| **Preview expiry:** a delayed `import_expire` job plus a check at confirm time (D-031). Both are idempotent, and expiry releases the single-import lock. | |
| **Relocation:** country and salary change in one event and one transaction; the snapshot holds the new `country_code` and `currency_code` (D-033). | |
| **Health:** `GET /health` runs `SELECT 1` → `200 {status:'ok', db:'ok'}` or `503 {status:'error', db:'down'}`. It's bounded by the pool's 2 s connection timeout and 5 s statement timeout. | No separate health timeout; the pool limits already bound it. |
| **Graceful shutdown:** on SIGTERM/SIGINT, stop accepting HTTP, let the worker finish its current row or job step, then close the pool. | |
| **Structured logs:** each request gets an ID (incoming `X-Request-Id` or `randomUUID()`), echoed in the response header and in every error body. Worker logs carry `jobId` and `type`. | |
| **Errors:** domain errors (`AppError(code, status, message, details)`) are thrown by services and mapped by one error handler. zod errors become `VALIDATION_ERROR` with field paths; PG unique violations become `DUPLICATE` with the field. Unknown errors are logged with the stack and returned as `INTERNAL` without it. | |
| **CI:** GitHub Actions on every push: `npm ci` → lint → typecheck → server tests (postgres:16 service) → web tests. | |

### 8.1 Determinism, dates and time zone (D-039)
- **Clock:** `Clock` (`{ now(): Date; today(): string }`) is injected everywhere time matters: status, effective-date rules, slip month limit, expiry, job scheduling.
  - `today()` returns `YYYY-MM-DD` in `APP_TIMEZONE` (default `Asia/Kolkata`), via `Intl.DateTimeFormat('en-CA', { timeZone })`. No date library is needed.
- **Calendar dates are strings:** `types.setTypeParser(1082 /* DATE */, v => v)` in `db/pool.ts`, so `DATE` columns come back as `YYYY-MM-DD` strings and are written back the same way.
  - Date comparisons are done on these strings (which sort correctly) or in SQL. The code never calls `new Date('YYYY-MM-DD')`, which parses as UTC midnight and shifts the day in other zones.
  - The web app does the same: date inputs and display use the strings as they are.
- **Other driver types:** `NUMERIC` stays a string (exact money). `count(*)` is cast `::int` in SQL.
- **Instants:** the DB session runs in UTC (`SET TIME ZONE 'UTC'` on connect). `timestamptz` values are instants; expiry and job times compare instants, so "24 h" is exact.
- **Tests run with `TZ=America/Los_Angeles`** (set in the Vitest config), so any accidental use of local time shows up as a failing test rather than a bug that only appears in production.
- The seed's PRNG takes a fixed seed. No test reads the real time or `Math.random()`.

### 8.2 Testing strategy
| Level | What | How |
|---|---|---|
| **Unit** (no DB, no HTTP) | Password hash/verify, money and rounding, `today()` in `APP_TIMEZONE`, `isInfrastructureError`, import row rules, status derivation, change diffing and validation (effective-date rules, note), exit and withdraw rules, slip calculation, CSV row validation, upload checks, formula escaping, job retry/backoff decisions | Services get fake in-memory repositories, a fixed `Clock` and a fake mailer |
| **Integration** | Routes + repositories + SQL: auth, list/filter/sort/search, optimistic locking, history immutability, conversion and insight queries (with exact expected numbers from small fixtures), the import pipeline, exports, download rules, the queue | Supertest against `createApp(deps)` on a **real PostgreSQL test DB** (`TEST_DATABASE_URL`), migrated once in global setup and truncated between tests. The worker is driven with `worker.runOnce()`, with no timers. |
| **Acceptance (required)** | T1–T18 from the requirements (§11) | Integration tests (T11 is also a web test) named after the requirement ID |
| **Web** | A few behaviour tests on key screens (login and `next` redirect, import preview actions, export too-large flow, export download page) | React Testing Library with `fetch` mocked |

## 9. Configuration (`.env.example`)
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/salary_management
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/salary_management_test
JWT_SECRET=change-me-to-a-random-32+-char-string
APP_TIMEZONE=Asia/Kolkata                   # defines "today" for all date rules
COOKIE_SECURE=false
CORS_ORIGIN=http://localhost:5173
APP_BASE_URL=http://localhost:5173          # SPA origin; email links point to $APP_BASE_URL/exports/:id
SMTP_HOST=sandbox.smtp.mailtrap.io          # Mailtrap Sandbox test inbox (or Mailpit: localhost:1025, no auth)
SMTP_PORT=2525
SMTP_USER=                                  # optional — empty means no SMTP auth
SMTP_PASS=
SMTP_FROM="Salary Management <no-reply@acme.local>"
SEED_ADMIN_EMAIL=hr@acme.local
SEED_ADMIN_PASSWORD=change-me
```
