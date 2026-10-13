# Salary Management

Web-based salary management for ACME's HR Manager — replaces Excel for managing pay data of ~10,000 employees across multiple countries and answering questions about how the org pays people.

## Demo
- Demo video: _TBD — link to be added after recording_
- Not deployed by design — runs locally (see [D-013](docs/DECISIONS.md)).

## What it does
- **Employees:** server-side paginated, sortable, filterable list with search and a reporting currency; create, edit, and record salary, title, department or country changes (each needs a note and an effective date); resignation and termination with notice periods.
- **History and audit:** every pay or title change is an append-only history entry (who, what, old → new, when, why).
- **Insights:** headcount and payroll, pay by country, department and job title, outliers against peers, recent changes, and who is leaving — all computed in SQL.
- **Salary slips:** gross monthly breakdown as of a month end, on screen or PDF.
- **Exchange rates:** INR-based rates with a change history; every converted figure uses them.
- **Import:** download the CSV template, upload, review a preview (created / updated / unchanged / rejected), then import the valid rows or cancel. Rejected rows download as a CSV you can fix and upload again. Previews expire after 24 h.
- **Export:** CSV and Excel stream any list size; PDF downloads up to 1,000 rows, and larger PDFs are built in the background and a link is emailed to you (it works for you only, for 24 h).

## Tech stack
- **Backend:** Node.js + TypeScript (run directly, no build step), Express 5, PostgreSQL via `pg` with plain parameterised SQL, node-pg-migrate, zod, pino, jose (JWT in an httpOnly cookie), nodemailer, pdfkit, exceljs.
- **Frontend:** React 19 + Material UI + TypeScript, TanStack Query, React Router, built with Vite.
- **Testing:** Vitest, Supertest (integration against a real PostgreSQL test database), React Testing Library.

## Setup
Prerequisites: Node 24.21.0 (`nvm use` reads `.nvmrc`) and PostgreSQL 14 or newer.

```bash
npm ci
cp .env.example .env            # then fill in the values below
createdb salary_management
createdb salary_management_test
npm run migrate -w server       # creates tables + countries and exchange-rate snapshot
npm run user:create -w server -- hr@acme.local "HR Manager"   # prints the password once
```

Account commands: `user:create`, `user:reset-password`, `user:disable`, `user:enable` (all `-w server -- <email>`).

### Configuration (`.env`, never committed)
| Variable | Notes |
|---|---|
| `DATABASE_URL` | the app's database |
| `TEST_DATABASE_URL` | a **separate** database for tests; tests empty it, so never point it at real data |
| `JWT_SECRET` | 32+ random characters |
| `COOKIE_SECURE` | `false` for plain-http localhost (Safari won't store `Secure` cookies over http); `true` anywhere with HTTPS |
| `CORS_ORIGIN`, `APP_BASE_URL` | the web app's origin; email links point to `APP_BASE_URL/exports/:id` |
| `APP_TIMEZONE` | default `Asia/Kolkata`; decides what "today" means |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | only needed to email large PDFs. Use a **test inbox**: Mailtrap Sandbox (from Inboxes → SMTP settings) or Mailpit (`localhost:1025`, no login). Without `SMTP_HOST` everything else works and an emailed export fails with a clear message |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | the HR user the seed creates if missing |

## Run
Two terminals:

```bash
npm run dev -w server           # API on http://localhost:3000, with the background job worker
npm run dev -w web              # app on http://localhost:5173 (proxies /api to the API)
```

Open http://localhost:5173 and sign in. The job worker (imports, emailed exports, cleanup) runs inside the API process and stops cleanly on SIGTERM/SIGINT. `GET /health` reports API and database status.

## Seed (10,000 employees)
```bash
npm run seed -w server            # refuses if employees already exist
npm run seed -w server -- --reset # wipes employees + history, restores the rate snapshot, reseeds
```

- **Deterministic:** fixed PRNG seed (42); all dates are relative to today in `APP_TIMEZONE`, so a run on the same day always produces identical data.
- **What it creates:** 10,000 employees across 8 countries and 8 departments (salaries from per-title bands × country pay level, in local currency), a `hire` history entry each, an `exit` entry for leavers (~3% on notice, ~4% exited), and a year of pay history for those staying: an annual review for most (+3–12%), some promotions to the next title (+10–20%) and a few relocations with new pay in the new currency. The current employee row always equals their latest history entry. It also creates the `SEED_ADMIN_EMAIL` HR user if missing (an existing account is left unchanged).
- **How:** batches of 1,000 rows via `INSERT … SELECT FROM unnest(...)`, all in one transaction.

**Measured** (MacBook Pro, Apple Silicon, PostgreSQL 14.3, Node 24.21.0):

| Run | 10,000 employees + 18,992 history entries |
|---|---|
| `--reset` (×3) | 1.78 s, 1.76 s, 1.58 s |

History breakdown (seed 42): 10,000 hires, 7,511 annual reviews, 479 promotions, 265 relocations, 737 exits.

## Test
```bash
npm test                        # server (unit + integration on TEST_DATABASE_URL) and web
npm run lint && npm run typecheck
```

At the time of writing: 432 server and 74 web tests. Time and email are injected (a fixed clock and a fake mailer), so nothing depends on the real clock or network. GitHub Actions runs lint, typecheck and the tests, against PostgreSQL 16, on every push.

## Security and reliability
Hashed passwords (scrypt), sessions that can be revoked at once (logout, disabled users), rate-limited login, restricted CORS, security headers, server-side validation of all input, no salary data in logs, a secrets-only-in-environment rule, and an append-only audit trail for pay changes and export downloads. Writes that touch several tables run in transactions, employee edits use optimistic locking, and background jobs are safe to retry. Details and trade-offs: [Architecture](docs/ARCHITECTURE.md) §6 and §8.

## Docs
- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/PLAN.md)
- [Decisions log](docs/DECISIONS.md)
- [Prompt log](docs/PROMPTS.md)
- [Working rules](CLAUDE.md)
