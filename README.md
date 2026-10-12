# Salary Management

Web-based salary management for ACME's HR Manager — replaces Excel for managing pay data of ~10,000 employees across multiple countries and answering questions about how the org pays people.

> Status: in development. Sections marked _TBD_ are filled in as the build progresses.

## Demo
- Demo video: _TBD_
- Not deployed by design — runs locally (see [D-013](docs/DECISIONS.md)).

## Tech stack
- Backend: Node.js + TypeScript, PostgreSQL (with migrations)
- Frontend: React + Material UI + TypeScript
- Testing: Vitest + Supertest

## Setup
Prerequisites: Node 24.21.0 (`nvm use` reads `.nvmrc`) and PostgreSQL 14 or newer.

```bash
npm ci
cp .env.example .env            # then fill in DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET (32+ chars)
createdb salary_management
createdb salary_management_test
npm run migrate -w server       # creates tables + countries and exchange-rate snapshot
npm run user:create -w server -- hr@acme.local "HR Manager"   # prints the password once
```

Account commands: `user:create`, `user:reset-password`, `user:disable`, `user:enable` (all `-w server -- <email>`).

## Run
Two terminals:

```bash
npm run dev -w server           # API on http://localhost:3000
npm run dev -w web              # app on http://localhost:5173 (proxies /api to the API)
```

Open http://localhost:5173 and sign in. For plain-http localhost keep `COOKIE_SECURE=false` in `.env` (Safari won't store `Secure` cookies over http).

## Seed (10,000 employees)
```bash
npm run seed -w server            # refuses if employees already exist
npm run seed -w server -- --reset # wipes employees + history, restores the rate snapshot, reseeds
```

- **Deterministic:** fixed PRNG seed (42); all dates are relative to today in `APP_TIMEZONE`, so a run on the same day always produces identical data.
- **What it creates:** 10,000 employees across 8 countries and 8 departments (salaries from per-title bands × country pay level, in local currency), a `hire` history entry each, and an `exit` entry for leavers (~3% on notice, ~4% exited). It also creates the `SEED_ADMIN_EMAIL` HR user if missing (an existing account is left unchanged).
- **How:** batches of 1,000 rows via `INSERT … SELECT FROM unnest(...)`, all in one transaction.

**Measured** (MacBook Pro, Apple Silicon, PostgreSQL 14.3, Node 24.21.0):

| Run | 10,000 employees + 10,675 history entries |
|---|---|
| Empty database | 1.72 s |
| `--reset` (×3) | 1.31 s, 1.25 s, 1.29 s |

## Test
```bash
npm test                        # server (unit + integration on TEST_DATABASE_URL) and web
npm run lint && npm run typecheck
```

## Docs
- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/PLAN.md)
- [Decisions log](docs/DECISIONS.md)
- [Prompt log](docs/PROMPTS.md)
- [Working rules](CLAUDE.md)
