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
_TBD_ — including measured timing.

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
