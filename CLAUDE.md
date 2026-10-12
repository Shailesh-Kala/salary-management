# CLAUDE.md — Working Rules

Rules for anyone (human or AI) contributing to this repo. They override defaults.

## Process
- Work in phases (0 Repo setup → 1 Requirements → 2 Design → 3 Build). Stop at every checkpoint and wait for explicit approval before continuing. Never skip a checkpoint.
- Phase 3 is TDD, one task from `docs/PLAN.md` at a time:
  1. Write failing test(s) → commit `test: <test case>`
  2. Minimum code to pass → commit `feat: <task>`
  3. Refactor if needed → commit `refactor: <task>`
  4. Run the full suite; never commit with failing tests
  5. Tick the task in `docs/PLAN.md`, summarise, wait for "next"
- If anything is unclear, ask instead of guessing. If you disagree with an instruction, say so and explain why.

## Commits
- Small, conventional commits: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`. One logical change per commit.
- Push after each task.
- Never squash or rewrite history.

## Code quality
- Layered structure: routes/controllers → services (business logic) → repositories (DB).
- Business logic must be unit-testable without HTTP or a real DB.
- Clear names, small functions, no dead code. Consistent formatting via linter + formatter.
- Centralised error handling with a consistent error response shape.

## Tests
- Fast, deterministic, readable (Arrange / Act / Assert).
- No real network. No reliance on time or random values without seeding/injection.
- Focus on core logic: salary validation, currency conversion, pay-insight calculations, CRUD rules, auth.
- A few API integration tests against an in-memory/test DB.

## Security
- Authentication for the HR Manager: hashed passwords, httpOnly secure cookies or short-lived JWT. All salary endpoints protected.
- Validate all input on the server with a schema library. Parameterised queries / ORM only.
- Secrets only in environment variables. Provide `.env.example`; never commit `.env`.
- Rate limiting on login, restricted CORS, security headers, no salary/PII in logs.
- Audit log for salary changes: who, what, old value, new value, when.

## Performance (10,000 employees)
- Server-side pagination, sorting, filtering and search — never send all rows to the UI.
- DB indexes on columns used for filtering/sorting (country, job title, department).
- Pay-insight aggregations computed in SQL, not application loops.
- Seed script: 10,000 realistic employees, batched/transactional, deterministic (fixed random seed), runs in seconds. Timing documented in README.

## Reliability & debuggability
- DB migrations; transactions for multi-step writes; optimistic locking / `updated_at` checks on salary edits.
- Health check endpoint, structured logging with request IDs, meaningful error messages.
- GitHub Actions CI runs lint + tests on every push.

## Documentation (keep updated as we go)
- `docs/PROMPTS.md`: after each user message, append the prompt, the phase, and a 1–2 line summary of the response. Commit it with the related work.
- `docs/DECISIONS.md`: log every meaningful decision — what, alternatives, why, trade-off.
- `README.md`: setup, run, seed, test, deploy, live URL, demo video link, links to all docs.
