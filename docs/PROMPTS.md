# Prompt Log

Each user prompt, the phase it belongs to, and a 1–2 line summary of the response.

---

## 1. Phase 0 — Repo setup

<details>
<summary>Prompt (verbatim)</summary>

```text
You are my pair-programming partner for an engineering assessment, where you must work in phases, stop at each checkpoint, and wait for my approval before continuing. Never skip a checkpoint.

## Context
- Build employee salary management software for an organization with 10,000 employees.
- User Persona:   HR Manager of the org   Today they use Excel.
- Problem Statement:   Currently, ACME org's HR team manages salary data for 10,000 employees across multiple countries, with everything managed via excels, which is tedious. We want the HR manager to manage the salaries data via web-based software and be able to answer questions about how the org pays people.

## Tech stack
- Backend: Node.js + Typescript
- Database: PostgreSQL with migrations
- Frontend: ReactJS  with Material UI + TypeScript
- Testing: Vitest + Supertest

## Phase 0 — Repo setup
1. Create a new public GitHub repo named "salary-management"
2. Initialise git, add .gitignore, README.md skeleton, and the docs/ folder.
3. Create CLAUDE.md containing the working rules
4. Create docs/PROMPTS, Requirement, Design architecture and Implementation Plan MD files
5. Commit each document separatly and push. STOP and show me the repo URL.

## Phase 1 — Requirements
Create docs/REQUIREMENTS.md, covering: goal, persona, in-scope features, explicitly out-of-scope items WITH reasoning, assumptions, and open questions. Address these in the brief:
- Multi-currency comparison
- Which concrete pay-insight questions HR should answer
- Data model fields
- Salary history/audit
- Monthly slip generate which containg the salary breakdown
- Excel/CSV import-export
- Authentication and data privacy
- Non-functional targets for 10k employees like what if there are so many request.
Keep scope small over complexity.  STOP for my review.

## Phase 2 — Design
Create docs/ARCHITECTURE.md with: architecture diagram, data model, API endpoint list, folder structure, and a section each for security, performance, and reliability decisions with trade-offs.
Create docs/PLAN.md: a numbered list of small tasks, each sized to 1–3 commits. STOP for my review.

## Phase 3 — Build with TDD, one task at a time. For each task in PLAN.md:
1. Write failing test(s) first then commit "test: {whatever is the testcase}"
2. Write the minimum code to pass the test then commit "feat: .{whatever is the task}"
3. Refactor if needed then commit "refactor: {whatever is the task}"
4. Run the full test suite; never commit with failing tests
5. Tick the task in PLAN.md, then briefly tell me what have we done and we will discuss if any discussion need to be made and wait for "next"

## Working rules (put these in CLAUDE.md)
Commits:
- Small and conventional commits (feat, fix, test, refactor, docs, chore, ci). One logical change per commit. Push after each task.
- Never squash or rewrite history.

Code quality:
- Layered structure: routes/controllers => services (business logic) => repositories (DB). Business logic must be unit-testable without HTTP or a real DB.
- Clear names, small functions, no dead code, consistent formatting via linter + formatter.
- Centralised error handling with consistent error response shape.

Tests:
- Fast, deterministic, readable (Arrange/Act/Assert). No real network, no reliance on time
  or random values without seeding/injection. Focus on core logic: salary validation,
  currency conversion, pay-insight calculations, CRUD rules, auth.
- Add a few API integration tests using an in-memory/test DB.

Security:
- Authentication for the HR Manager (hashed passwords, httpOnly secure cookies or short-lived
  JWT). Protect all salary endpoints.
- Validate all input on the server with a schema library. Parameterised queries/ORM only.
- Secrets only in environment variables; provide .env.example, never commit .env.
- Rate limiting on login, CORS restricted, security headers, no salary/PII in logs.
- Audit log for salary changes (who, what, old value, new value, when).

Performance (10,000 employees):
- Server-side pagination, sorting, filtering and search — never send all rows to the UI.
- Database indexes on columns used for filtering/sorting (country, job title, department).
- Pay-insight aggregations computed in SQL, not in application loops.
- Seed script inserts 10,000 realistic employees in batches/transactions, is deterministic
  (fixed random seed), and runs in seconds. Document the timing.

Reliability & debuggability:
- DB migrations, transactions for multi-step writes, optimistic locking or updated_at
  checks on salary edits.
- Health check endpoint, structured logging with request IDs, meaningful error messages.
- GitHub Actions CI running lint + tests on every push.

Documentation keep updated as we go:
- docs/PROMPTS.md: after each of my messages, append my prompt, the phase, and a 1–2 line summary of what you did in response. Commit this file along with the related work.
- docs/DECISIONS.md: log every meaningful decision (what, alternatives, why, trade-off).
- README.md: setup, run, seed, test, deploy instructions, live URL, demo video link,
  and links to all docs.

General:
- If anything is unclear, ask instead of guessing or assuming
- If you disagree with my instruction, raise it and explain why.

Start with Phase 0 now.
```
</details>

**Response:** Created public repo `salary-management`, added `.gitignore`, README skeleton, `CLAUDE.md` with the working rules, and skeleton docs (PROMPTS, REQUIREMENTS, ARCHITECTURE, PLAN, DECISIONS) — one commit per file, pushed.
