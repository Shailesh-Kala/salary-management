# Architecture

This document turns [REQUIREMENTS.md](REQUIREMENTS.md) into a design. Decision references (D-xxx) point to [DECISIONS.md](DECISIONS.md).

## 1. Overview
- **One Node.js process** serves the JSON API and runs the background job worker. **One PostgreSQL database** holds all data, including the job queue and generated files.
- **The React single-page app** is served by Vite in development and talks to the API on the same origin, through the Vite proxy.
- **No other infrastructure.** SMTP is the only external dependency, and it is used only for large-export emails (Mailpit locally).

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

  PG[("PostgreSQL 16<br/>employees · employee_changes · imports<br/>import_rows · exports · jobs · …")]
  SMTP["SMTP<br/>(Mailpit locally)"]

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
  validating --> awaiting_confirmation: validate job done
  validating --> cancelled: POST /imports/:id/cancel
  awaiting_confirmation --> applying: POST /imports/:id/confirm
  awaiting_confirmation --> cancelled: POST /imports/:id/cancel
  applying --> completed: all rows have a final outcome
  validating --> failed: 3 attempts exhausted
  applying --> failed: 3 attempts exhausted
  completed --> [*]
  cancelled --> [*]
  failed --> [*]
```
- **Active** states are `validating`, `awaiting_confirmation` and `applying`. At most **one** import can be active, enforced by a partial unique index (D-021).
- **Apply** loops over rows that are valid in the preview and have `applied_at IS NULL`, in `row_number` order. **Each row runs in one transaction:**
  1. lock or look up the employee
  2. re-validate the row
  3. upsert the employee
  4. insert an `employee_changes` row with `import_id` and `import_row_number`
  5. set `import_rows.outcome` and `applied_at`
  6. commit

  On retry, rows that already have `applied_at` are skipped. As a second guard, a unique index on `employee_changes (import_id, import_row_number)` makes a duplicate history row impossible (D-020).

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
    W->>M: send link to requester's own address
    Note over W,M: on send error → clear email_sent_at, throw → retry
  end
  UI->>API: GET /exports/:id/download (from email link)
  API->>DB: requester? not expired? → audit outcome
  API-->>UI: 200 PDF | 403 | 410
```

## 2. Tech stack
| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24.21.0 | Runs `.ts` directly with native type stripping, so no build step for the server (D-022) |
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
| Email | `nodemailer` (SMTP) | Mailpit locally; a fake mailer in tests |
| Uploads | `multer` (memory storage, 5 MB limit) | CSV only |
| Frontend | React 19, Vite, TypeScript, MUI, MUI X DataGrid (server mode), React Router, TanStack Query | D-026 |
| Tests | Vitest, Supertest, React Testing Library | Real PostgreSQL test DB (D-027) |
| Lint / format | ESLint (typescript-eslint) + Prettier | Run in CI |
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
```

### 3.1 Tables
**`hr_users`**: `id`, `email` (unique, stored lower-case), `name`, `password_hash` (`scrypt$N$r$p$salt$hash`), `created_at`.

**`countries`**: `code char(2) PK`, `name`, `currency_code char(3) FK → exchange_rates`.

**`exchange_rates`**: `currency_code char(3) PK`, `inr_per_unit numeric(18,6) CHECK > 0`, `as_of date`, `updated_by FK`, `updated_at`. INR's row is fixed at 1.

**`employees`**
| Column | Type / constraint |
|---|---|
| id | uuid PK |
| employee_code | text UNIQUE NOT NULL |
| first_name, last_name | text NOT NULL |
| email | text UNIQUE NOT NULL (lower-case) |
| job_title, department | text NOT NULL (trimmed) |
| country_code | char(2) FK → countries |
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
| change_type | text CHECK in (`hire`,`annual_review`,`promotion`,`market_adjustment`,`correction`,`exit`,`exit_withdrawn`,`other`) |
| effective_date | date NOT NULL |
| note | text NOT NULL (5–1000 chars) |
| source | text CHECK in (`ui`,`import`,`seed`) |
| changes | jsonb: `{ field: { old, new } }`, only the fields that changed |
| base_salary, allowances, currency_code, job_title, department | snapshot of values **after** this change |
| changed_by | uuid FK → hr_users |
| import_id, import_row_number | NULL unless `source = import`; UNIQUE together (retry guard) |
| changed_at | timestamptz |

- **Indexes:** `(employee_id, effective_date DESC, id DESC)` for the timeline and slip lookups; `(changed_at)` for Q6.
- **Immutability:** a `BEFORE UPDATE OR DELETE` trigger raises an exception, so even a buggy repository can't rewrite history.

**`imports`**
| Column | Notes |
|---|---|
| id, uploaded_by, file_name | |
| status | `validating` \| `awaiting_confirmation` \| `applying` \| `completed` \| `cancelled` \| `failed` |
| change_type, effective_date, note | applied to every change in the import |
| file | bytea; the raw CSV, cleared once the import is completed, cancelled or failed |
| counts | jsonb: `{ total, valid, toCreate, toUpdate, unchanged, rejected, created, updated }` |
| error | text, set when the import failed |
| created_at, finished_at | |

- **Partial unique index:** `CREATE UNIQUE INDEX one_active_import ON imports ((true)) WHERE status IN ('validating','awaiting_confirmation','applying')` (D-021).

**`import_rows`**: `(import_id, row_number) PK`, `employee_code`, `raw jsonb`, `preview_outcome` (`create` \| `update` \| `unchanged` \| `rejected`), `outcome` (`created` \| `updated` \| `unchanged` \| `rejected` \| NULL until applied), `errors jsonb`, `applied_at`.

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
| type | `import_validate` \| `import_apply` \| `export_pdf` \| `export_cleanup` |
| payload | jsonb, e.g. `{ importId }` / `{ exportId }` |
| status | `queued` \| `running` \| `completed` \| `failed` |
| attempts, max_attempts | default max 3 |
| run_after | timestamptz; used for delayed jobs (cleanup) and retry backoff |
| locked_until | lease; a `running` job whose lease has passed is considered crashed and can be re-claimed |
| last_error | text: error message only, never row data |
| created_at, updated_at | |

- **Index:** `(status, run_after)`.

### 3.2 Seed data
- **Countries and currencies:** IN/INR, US/USD, GB/GBP, DE/EUR, FR/EUR, SG/SGD, AU/AUD, CA/CAD, with a fixed rate snapshot.
- **One HR user** from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- **10,000 employees** generated with a seeded PRNG (`mulberry32`, about 10 lines, no dependency) and built-in name, title and department lists. Each employee gets a `hire` history row.
- Rows are inserted with multi-row `INSERT … SELECT * FROM unnest($1::text[], …)` in batches of 1,000, inside one transaction. Target < 10 s; the measured time goes in the README.

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
| `POST /api/auth/login` | Email + password → sets cookie | Rate limited (5/min per IP+email); generic failure message |
| `POST /api/auth/logout` | Clears cookie | |
| `GET /api/auth/me` | Current user | |
| **Reference data** | | |
| `GET /api/countries` | Countries with currency | |
| `GET /api/exchange-rates` | All rates with `as_of` | |
| `PUT /api/exchange-rates/:currency` | Update one rate | `{inrPerUnit, asOf}`; INR is immutable |
| `GET /api/employees/filter-options` | Distinct departments and job titles | For filter dropdowns |
| **Employees** | | |
| `GET /api/employees` | List | `page`, `pageSize` (≤100), `sort` (whitelist: `name`, `employeeCode`, `jobTitle`, `department`, `country`, `hireDate`, `annualSalary`), `order`, `q`, `country`, `department`, `jobTitle`, `status`, `currency` (default INR). Returns `{items, total, page, pageSize, ratesAsOf}` |
| `POST /api/employees` | Create | Writes the employee and a `hire` change in one transaction |
| `GET /api/employees/:id` | Detail | Includes `version` and the derived `status` |
| `PATCH /api/employees/:id` | Edit non-audited fields (name, email) | `{version, …}`; `409 VERSION_CONFLICT` on a stale version |
| `POST /api/employees/:id/changes` | Audited change event | `{version, changeType, effectiveDate, note, baseSalary?, allowances?, jobTitle?, department?}`; at least one field must actually change |
| `GET /api/employees/:id/changes` | History timeline | Newest first |
| `POST /api/employees/:id/exit` | Record resignation or termination | `{version, exitType, noticeDate, lastWorkingDay, note}` |
| `POST /api/employees/:id/exit/withdraw` | Withdraw while on notice | `{version, note}` |
| `GET /api/employees/:id/slips/:month` | Monthly slip | `month` = `YYYY-MM` and ≤ the current month; `?format=pdf` returns a PDF |
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
| `POST /api/imports/:id/confirm` | `awaiting_confirmation` → `applying` | `409 INVALID_STATE` otherwise |
| `POST /api/imports/:id/cancel` | `validating` or `awaiting_confirmation` → `cancelled` | Any HR user |
| **Exports** | | |
| `GET /api/exports/employees` | Direct download | `format=csv\|xlsx\|pdf` plus the list filters. PDF with > 1,000 rows → `422 EXPORT_TOO_LARGE` (the UI then offers email) |
| `POST /api/exports/employees/email` | Queue a large PDF | List filters; `202 {exportId}`; sent to the requester's own email |
| `GET /api/exports` | My emailed exports and their status | |
| `GET /api/exports/:id/download` | Download an emailed export | `403` if not the requester, `410` if expired or deleted; every attempt audited |

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
│  │  └─ seed.ts           # deterministic 10k seed, prints timing
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
      └─ pages/            # Login, Employees, EmployeeDetail, EmployeeForm, Slip,
                           # Insights, Imports, ImportDetail, Exports, ExchangeRates
```

## 6. Security decisions
| Decision | Trade-off |
|---|---|
| **Passwords:** `crypto.scrypt` (N=2¹⁵, r=8, p=1) with a random 16-byte salt; compared with `timingSafeEqual`. On an unknown email, a dummy hash is still computed so response timing doesn't reveal whether the account exists (D-025). | Uses the built-in KDF rather than argon2id. scrypt is memory-hard and widely accepted, and avoids native modules. |
| **Session:** HS256 JWT (`jose`) with `sub` and `exp` = 8 h, in a cookie set `httpOnly; SameSite=Strict; Path=/`. `Secure` is controlled by `COOKIE_SECURE`: true by default, false in `.env.example` for http://localhost. | A stateless token can't be revoked before expiry. Logout clears the cookie. With few users and 8 h expiry this is acceptable; a denylist is the upgrade path. |
| **CSRF:** `SameSite=Strict`, plus every state-changing route requiring `Content-Type: application/json` or `multipart/form-data` from the same origin. | No CSRF token. That's safe for modern browsers with SameSite=Strict. |
| **Authorisation:** `requireAuth` is applied router-wide under `/api`; only login is exempt. Export downloads also check `requested_by = user.id`. | A single role (D-008), so there's no per-record ACL apart from exports. |
| **Input validation:** zod schemas on every body and query; sort fields come from a whitelist mapped to SQL column expressions; unknown fields are rejected. | |
| **SQL:** parameterised only (`$1…`). No string-built SQL except whitelisted identifiers from a fixed map. | Hand-written SQL needs care, so review and tests cover it. |
| **Rate limits:** login 5/min per IP+email; API 300/min per user (`express-rate-limit`, in-memory store). | An in-memory store is per process, which is fine for a single instance. A Redis store is the upgrade path if the app is ever scaled out. |
| **Headers and CORS:** `helmet` defaults (CSP, HSTS when Secure, `X-Content-Type-Options`, etc.); CORS allows only `CORS_ORIGIN`, with credentials. | |
| **Body limits:** JSON 100 kB; multipart 5 MB, one file, `.csv` / `text/csv` only. | |
| **Logging:** pino logs `requestId`, method, route, status and duration. `redact` removes `req.headers.cookie`, `authorization` and `set-cookie`. Bodies and query strings are never logged, and job errors log codes and messages only. | Debugging data problems needs a DB query rather than log reading. That's the intended privacy trade. |
| **Audit:** `employee_changes` (who, what, old → new, when, note) and `export_downloads` are append-only, enforced by a DB trigger. Every export is recorded in `exports`. | Name and email edits aren't audited (D-011). |
| **Spreadsheet formula injection:** CSV and Excel cells starting with `= + - @ \t \r` are prefixed with `'`. | The value looks slightly different when opened in a text editor. |
| **Emailed exports:** sent only to the requester's address, with a link but no attachment. Downloading needs the same user's session, the link expires in 24 h, and the file is deleted by a delayed cleanup job (D-018). | A colleague can't receive an export. |
| **Secrets:** env only (`DATABASE_URL`, `JWT_SECRET` ≥ 32 chars, `SMTP_*`, `SEED_ADMIN_*`), validated at startup. `.env.example` is committed and `.env` is git-ignored. | |

## 7. Performance decisions
| Decision | Trade-off |
|---|---|
| **Server-side list:** `LIMIT/OFFSET` with `pageSize ≤ 100` and a stable `ORDER BY <col>, id`. One `count(*)` with the same filters. | OFFSET slows on deep pages at very large scale. At 10k–100k rows it takes milliseconds; keyset pagination is the upgrade path (D-029). |
| **Indexes:** B-tree on `country_code`, `department`, `job_title`, `last_working_day`, `(last_name, first_name)`; trigram GIN for `q`; `(employee_id, effective_date DESC, id DESC)` and `(changed_at)` on changes; `(status, run_after)` on jobs. | A little extra write cost, which is negligible for this workload. |
| **Reporting-currency sort:** `ORDER BY (base_salary + allowances) * r_from.inr_per_unit / r_to.inr_per_unit` through a join to `exchange_rates`. | Can't use an index (it's a computed value). Sorting 10k rows in memory takes about 5 ms; a generated column would go stale when rates change. |
| **Insights in SQL:** `count`, `sum`, `avg`, `percentile_cont(0.5) WITHIN GROUP`, `min`, `max`, `GROUP BY`. Outliers (Q5) use a CTE of medians per `(job_title, country)` joined back. Conversion is done inside the query. | No caching; it's added only if measurements show a need. |
| **DB pool:** 10 connections; `statement_timeout = 5s` for API queries. The worker's import transactions are short (one row each), so they stay well under it. | A runaway query fails fast instead of piling up. |
| **Exports:** CSV and Excel stream rows in keyset-paged chunks of 1,000 from the DB straight into the HTTP response. PDF is built from at most 1,000 rows directly, or in the worker for larger exports. | Memory stays flat at about 1,000 rows. |
| **Import:** parse the whole file (≤ 5 MB) once in the validate job. Bulk-load existing employees by code and email in one query, so validation doesn't query the DB per row. Apply is one transaction per row (D-019). | Apply is slower than batched writes; the target is < 60 s for 10k rows, in the background. |
| **Seed:** `unnest` multi-row inserts, 1,000 rows per statement, in one transaction. | |
| **Frontend:** DataGrid in server mode for paging, sorting and filtering; search debounced by 300 ms; TanStack Query caching; polling only while a job is active. | |

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
| **Health:** `GET /health` runs `SELECT 1` with a 1 s timeout → `200` or `503`. | |
| **Graceful shutdown:** on SIGTERM/SIGINT, stop accepting HTTP, let the worker finish its current row or job step, then close the pool. | |
| **Structured logs:** each request gets an ID (incoming `X-Request-Id` or `randomUUID()`), echoed in the response header and in every error body. Worker logs carry `jobId` and `type`. | |
| **Errors:** domain errors (`AppError(code, status, message, details)`) are thrown by services and mapped by one error handler. zod errors become `VALIDATION_ERROR` with field paths; PG unique violations become `DUPLICATE` with the field. Unknown errors are logged with the stack and returned as `INTERNAL` without it. | |
| **CI:** GitHub Actions on every push: `npm ci` → lint → typecheck → server tests (postgres:16 service) → web tests. | |

### 8.1 Determinism
- `Clock` (`{ now(): Date; today(): string }`) is injected everywhere time matters: status, effective-date rules, slip month limit, expiry, job scheduling.
- The seed's PRNG takes a fixed seed. No test reads the real time or `Math.random()`.

### 8.2 Testing strategy
| Level | What | How |
|---|---|---|
| **Unit** (no DB, no HTTP) | Password hash/verify, money and rounding, status derivation, change diffing and validation (effective-date rules, note), exit and withdraw rules, slip calculation, CSV row validation, upload checks, formula escaping, job retry/backoff decisions | Services get fake in-memory repositories, a fixed `Clock` and a fake mailer |
| **Integration** | Routes + repositories + SQL: auth, list/filter/sort/search, optimistic locking, history immutability, conversion and insight queries (with exact expected numbers from small fixtures), the import pipeline, exports, download rules, the queue | Supertest against `createApp(deps)` on a **real PostgreSQL test DB** (`TEST_DATABASE_URL`), migrated once in global setup and truncated between tests. The worker is driven with `worker.runOnce()`, with no timers. |
| **Acceptance (required)** | T1–T10 from the requirements (§11) | Integration tests named after the requirement ID |
| **Web** | A few behaviour tests on key screens (login, import preview actions, export too-large flow) | React Testing Library with `fetch` mocked |

## 9. Configuration (`.env.example`)
```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/salary_management
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/salary_management_test
JWT_SECRET=change-me-to-a-random-32+-char-string
COOKIE_SECURE=false
CORS_ORIGIN=http://localhost:5173
APP_BASE_URL=http://localhost:5173          # used in export email links
SMTP_HOST=localhost
SMTP_PORT=1025                              # Mailpit
SMTP_FROM="Salary Management <no-reply@acme.local>"
SEED_ADMIN_EMAIL=hr@acme.local
SEED_ADMIN_PASSWORD=change-me
```
