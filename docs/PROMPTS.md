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

---

## 2. Phase 0 — Repo setup (follow-up)

```text
The reason for single repo is we will be sending the code for assessment review so we don't need seprate repo.
1. Node version: please update the node version to 24.21.0
2. Yes already have database which I will config on .env file by myself
```

**Response:** Updated D-001 rationale (single repo for assessment review), installed Node 24.21.0 via nvm as default, pinned it in `.nvmrc`, logged D-002. Noted DB connection will be supplied by the user via `.env`.

---

## 3. Phase 1 — Requirements

```text
next
```

**Response:** Wrote `docs/REQUIREMENTS.md` (goal, persona, 7 in-scope features incl. 6 concrete pay-insight questions, out-of-scope table with reasoning, data model fields, auth/privacy, NFR targets incl. high-load handling, assumptions, 7 open questions with defaults) and logged decisions D-003–D-008.

---

## 4. Phase 1 — Requirements (review feedback)

```text
Few things in the requirement which we can add:
- Employees can resign and have notice period so we could add some status there and last working day something
- While updating the salary of any employee there should some note or appreciation/feedback
- Export feature should have select format options like CSV, PDF or Excel

Here are open questions answers:
Q1. Show gross pay only because a flat per-country estimate is risky as real deductions depend on tax brackets.
Q2. Yes, Job title changes matter for pay based on promotion
Q3. No, we will need to take consent
Q4. Yes, Rupees should be default
Q5. Yes, updated by employee code
Q6. We don't need to deploy or host it anywhere so drop this
Q7. Yes, but there should be reason/note required
```

**Response:** Revised REQUIREMENTS.md: added lifecycle (active / on_notice / exited, derived from dates) with resignation and last working day, required change type + note on every pay/title change, CSV/Excel/PDF export (PDF capped at 1,000 rows), gross-only slips, INR default, broader audit, new Q6/Q7 insights; dropped deployment from README/CLAUDE.md. Logged D-009–D-014 and marked superseded decisions; raised OQ8 (xlsx import) and OQ9 (PDF cap).

---

## 5. Phase 1 — Requirements (open questions OQ8–OQ9)

```text
Q8. Let's only accept to CSV format and give user to an template on which there will be pre defined example values with headers and we need to put validation on the file size and how many rows will be accepted and rejected that report should be available to user as we can put the import in the queue in the background job
Q9. Let's make it 1000 rows at a time and if user wants more then suggest that it will it will be sended over email and ask for the email on which user want the export value and these process will be in the background queue
```

**Response:** Added CSV template with example rows, upload limits, background import job with accepted/rejected report and rejected-rows CSV, PDF > 1,000 rows via background job + email, and a PostgreSQL-backed job queue (F9). Logged D-015–D-017; raised OQ10 (email a login-protected expiring link instead of an attachment) and OQ11 (partial import vs all-or-nothing).

---

## 6. Phase 1 — Requirements (open questions OQ10–OQ11)

```text
let's do:
Q10. Yes, link only, with one tightening. But since the link already requires an HR login, the simplest safe design is to send the email only to the logged-in user's own account address, with no typed-in recipient at all. That removes the mistyped-address risk completely and makes the domain allowlist unnecessary.
Few more things here:
- the generated file to be deleted when the link expires,
- each download recorded in the audit log, and
- the link to work only for the user who requested the export.
Q11. Yes, partial import, with a preview step first:
- Validate all rows and show counts (valid / rejected) before anything is saved.
- The user chooses "Import valid rows" or "Cancel".
- Rejected rows are downloadable as a CSV with an added "error" column so they can be
fixed and re-uploaded (safe because import upserts by employee code).
Each row is saved in its own transaction. Salary changes from import still create history
and audit entries.

Log both as decisions, and add tests for: the preview counts, cancel saving nothing, the
rejected-rows CSV, and the download link rejecting other users and expired links.
```

**Response:** Updated REQUIREMENTS.md: emailed exports go only to the requester's own address, link bound to the requester, 24 h expiry with file deletion via a scheduled cleanup job, downloads audited; import gains a preview → confirm/cancel step with per-row transactions and re-validation at apply. Added §11 required acceptance tests T1–T7 (to be written first in Phase 3) and logged D-018, D-019.

---

## 7. Phase 1 — Requirements (decisions log review)

```text
I went through the decisions log, it's looking good but a few things need fixing.

1. Retries. D-017 retries jobs 3 times but nothing stops a retried import from running rows again that were already saved. With one transaction per row this matters even more, since a crash leaves some rows done. Please save the row result in the same transaction and skip finished rows on retry. Also don't send the export email again on retry. Add tests for both.
2. Please remove "project owner wants" from all the reasons (D-002, D-009, D-010, D-012,
D-013, D-015, D-016, D-018, D-019). Most of them already have the real reason right after it, so just keep that part.

New:
3. Can a new upload start while another one is waiting in preview? No can't upload new.
4. D-014 says no cron job, but D-018 now adds a scheduled cleanup job. Update D-014's
reason so it's about status never drifting from the dates instead.
```

**Response:** Added idempotent retries (row outcome saved in the row's transaction, finished rows skipped; export email marked sent before sending, never re-sent) as D-020; one active import org-wide, enforced by DB constraint, `409` otherwise, as D-021; reworded all "project owner" reasons and D-014's reason. Added acceptance tests T8–T10.

---

## 8. Phase 2 — Design

```text
Next
```

**Response:** Wrote `docs/ARCHITECTURE.md` (mermaid architecture/state/sequence/ER diagrams, stack, tables with constraints and indexes, full API list and error shape, folder structure, security/performance/reliability decisions with trade-offs, testing strategy, `.env` keys) and `docs/PLAN.md` (38 TDD tasks in 8 milestones, acceptance tests T1–T10 mapped to tasks). Logged D-022–D-030.

---

## 9. Phase 2 — Design (architecture review)

```text
I went through ARCHITECTURE.md, few things:

1. The email link won't work. The cookie is SameSite=Strict, so when HR clicks the link from Gmail or Outlook web the browser won't send the cookie and they'll get a 401. Make the link open a page in the React app (like /exports/:id) and download the file from there with fetch. Please add a test for this.

2. Previews still don't expire. Please add the 24 hour expiry to the import flow and a cleanup job for it. Also clear import_rows.raw once an import is finished, cancelled or failed, we don't need to keep salary data there. Just keep row number, employee code, outcome and errors.

3. Country can't be changed after an employee is created, but relocations should be
supported. Let's make it an audited change type "relocation". Since currency follows
country, the new base salary and allowances in the new currency have to be entered in
the same change. Old history and past slips should keep the old currency. Imports can
relocate too, but only if the row has the new salary as well.

4. Can we reorder the plan so we build in slices? Like employees API then the employee list page, insights API then insights page. Email export and the job queue at the end. I want the app to be usable at every stage, not have all the UI at the end.

Small things:
- The CSRF note isn't quite right, forms can send multipart cross-site. SameSite=Strict is what protects us, so just say that.
- Rate changes should be audited, add a small rate history table.
- Turn on erasableSyntaxOnly in tsconfig since we're running TS directly on Node.
```

**Response:** Email links now open the SPA page `/exports/:id`, which downloads via same-site `fetch` (T11); previews expire after 24 h via `import_expire` job + confirm-time check, and file/raw rows are nulled when an import ends (T12, T13); added `relocation` change type requiring new salary, with country/currency in snapshots and import support (T14); fixed CSRF note; added `exchange_rate_changes`; tsconfig flags listed in ARCHITECTURE and Task 1. Re-ordered PLAN.md into 13 usable slices (41 tasks). Logged D-031–D-035.

---

## 10. Phase 2 — Design (full docs review)

```text
I went through REQUIREMENTS, DECISIONS, ARCHITECTURE and PLAN. I found a few things I want fixed:

- Some import rules are not clear:
   - When an import creates a new employee, the history entry should be a "hire" with the hire date, not the import's change type and date.
   - What happens if a row changes name, email or hire date for an existing employee? Is it allowed, and does it count as "updated" or "unchanged"? Also, there's no way to fix a wrong hire date anywhere right now.
   - Import updates to exited employees should only be allowed as corrections, same as in the UI.

- One broken row shouldn't fail the whole import. If one row throws an unexpected error, mark that row as rejected and keep going. Only retry the whole job for real problems like a crash or lost DB connection.

- If we remove an HR user, they still have access for up to 8 hours because the session can't be cancelled. Add a disabled flag (or token version) that's checked on each request.
- Please decide which timezone "today" uses, and make the pg driver return DATE columns as strings, to avoid off-by-one-day bugs.
```

**Response:** Added an import row-rules table (new employee → `hire` on hire date; name/email → updated without history; hire date and exited-employee changes only via `correction`) and hire-date correction in the UI (D-036); per-row error isolation with an infrastructure-error classifier (D-037); revocable sessions via `token_version` + `disabled_at` checked per request and a user CLI (D-038); `APP_TIMEZONE=Asia/Kolkata` for "today", DATE as strings, tests under `TZ=America/Los_Angeles` (D-039). New acceptance tests T15–T18 placed in PLAN tasks 4, 6, 9, 34, 35.

---

## 11. Phase 3 — Task 1: Workspace scaffold

```text
next
```

**Response:** Scaffolded the npm workspace (`server`), TypeScript 6.0 with `erasableSyntaxOnly`/`verbatimModuleSyntax`/`noEmit`, ESLint (typescript-eslint) + Prettier, Vitest, exact-pinned tools, `engines: node 24.21.0`, `.env.example`. Lint, typecheck, test and `node server/src/main.ts` all pass. Logged D-040 (TS 6.0 pin).

---

## 12. Phase 3 — Task 2: CI

```text
Next
```

**Response:** Added `.github/workflows/ci.yml` (Node from `.nvmrc`, npm cache, `postgres:16` service, `TEST_DATABASE_URL`, `npm ci` → lint → typecheck → test). GitHub did not start the job because the account is locked for billing; the same steps pass locally from a clean `npm ci`.

---

## 13. Phase 3 — Task 2: CI (re-run)

```text
run CI workflow now
```

**Response:** Re-ran the blocked CI run; it passed end to end (checkout, Node from `.nvmrc`, `npm ci`, lint, typecheck, test, `postgres:16` service). Updated the Task 2 note in PLAN.md.

---

## 14. Phase 3 — Task 3: App skeleton

```text
next
```

**Response:** TDD: committed failing tests (health + request ID echo/generation/unsafe-ID replacement, 404 error shape, AppError mapping, generic 500 without message/stack, env validation), then `config.ts` (zod), `AppError`, central `errorHandler`, `createApp({ logger })` with pino-http request IDs, `GET /health`, and `main.ts` loading `.env` via Node's `--env-file-if-exists`. 10 tests pass.

---

## 15. Phase 3 — Between tasks 3 and 4 (question)

```text
what is TEST_DATABASE_URL why do we need?
```

**Response:** Explained it is a separate database used only by integration tests (tests truncate tables, need exact known data, must run on real Postgres per D-027, mirrors CI). Promised a guard in Task 4 that refuses to run tests if it is missing or equals `DATABASE_URL`.

---

## 16. Phase 3 — Between tasks 3 and 4 (SMTP config)

```text
I am using mailtrap Sandbox test email cred can we add email username and password and port on the .env example
```

**Response:** Added `SMTP_USER` / `SMTP_PASS` and Mailtrap Sandbox host/port (`sandbox.smtp.mailtrap.io:2525`) to `.env.example`, with Mailpit as a no-auth alternative; SMTP auth is optional. Updated ARCHITECTURE and REQUIREMENTS to match.

---

## 17. Phase 3 — Task 4: Database and test harness

```text
Done, Next
```

**Response:** Created the missing `salary_management` database (only the test DB existed). TDD: failing tests for DATE-as-string under `TZ=America/Los_Angeles` (T17 DB part), UTC session + 5 s statement timeout, reference data, `withTransaction` commit/rollback, `/health` db ok/503, and the test-DB guard; then `pg` pool, `withTransaction`, node-pg-migrate runner + `npm run migrate`, migration `0001` (users, rates, countries, rate history, `load_reference_data()`), Vitest global setup and `resetDb()`. 20 tests pass; migrated the app DB; live `/health` ok. Logged D-041; noted PostgreSQL 14+ (local 14.3, CI 16).

---

## 18. Phase 3 — Task 5: Password hashing

```text
next
```

**Response:** TDD: failing tests (round-trip, wrong password, self-describing salted format, six malformed stored hashes return false instead of throwing), then `password.ts` using built-in `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte salt, 64-byte key, `timingSafeEqual`, maxmem raised to 64 MiB). ~96 ms per verify. 29 tests pass.

---

## 19. Phase 3 — Task 5 follow-up (review notes)

```text
Looks good, thanks. A few small things:
- Please confirm verify and hash use async crypto.scrypt, not scryptSync, so a login doesn't block the server.
- The login limit is per IP + email, so one IP can try many different emails. In Task 7, please also add a per-IP limit (say 20/min) no matter which email is used.
- When a stored hash is malformed, log a warning (without the hash) so we notice bad data, while still returning false.
```

**Response:** Confirmed only async callback `scrypt` is used (grep: no `scryptSync`). TDD: `verifyPassword` takes an optional logger and warns "stored password hash is malformed" (no hash) for malformed formats and for parameters scrypt refuses; no warning for a wrong password. Added a 20/min per-IP login limit to Task 7, REQUIREMENTS and ARCHITECTURE; logged D-042. 31 tests pass.

---

## 20. Phase 3 — Task 6: Login, logout, me, revocation, user CLI

```text
next
```

**Response:** TDD: failing integration tests (cookie flags and 8 h Max-Age, identical generic 401 for wrong password/unknown email, 400 with field details, `/me`, every `/api` route protected, tampered token, expiry with injected clock, logout + replayed token, disable ends sessions and blocks login — T16) plus malformed-JSON 400, 413 body limit, zod → 400 mapping and new config keys; then `jose` HS256 tokens with `tv`, auth service (dummy hash for unknown emails, per-request user re-check), `requireAuth`, `express.json` + `cookie-parser`, `user:create`/`user:disable` CLI. 46 tests pass; CLI verified against the test DB. Logged D-043.

---

## 21. Phase 3 — Task 6 follow-up (review notes)

```text
Before "next":
- Yes, please add user:reset-password. Disable + create doesn't work because the email is still taken by the disabled account, and it would split the person's history across two user IDs. Generate a new password, print it once, and bump token_version. Please add user:enable too.
- Is the cookie's Secure flag controlled by COOKIE_SECURE? Safari may not store Secure cookies on http://localhost, so login would look fine but every request after it would fail.
- A disabled user's login should give the same generic 401, with the same timing as a wrong password.
- Make the log parameter of verifyPassword required now that login passes it.
```

**Response:** Confirmed `secure: config.COOKIE_SECURE` (default true; user's `.env` is false) and added a test that `false` omits `Secure`. Confirmed disabled users already go through the same single hash check; added a unit test proving unknown / wrong / disabled each call `verifyPassword` once and throw the identical error (found and fixed a test bug: a `beforeEach` that returned the mock was run by Vitest as a cleanup hook). TDD: `resetPassword` (new password, `token_version` bump, same user ID) and `enableUser`, plus `user:reset-password` / `user:enable` CLI; refactor made `log` required. 54 tests pass. Logged D-044.

---

## 22. Phase 3 — Task 7: Security middleware

```text
next
```

**Response:** TDD: failing tests for the 6th same-email login (429), the 21st login from one IP with different emails (429), 300 API requests/user then 429 + `Retry-After`, helmet headers, CORS allow/deny, and a log-capture test (no cookie, query, salary, email or password); then `express-rate-limit` (20/min per IP + 5/min per IP+email on login, 300/min per user on `/api`, errors in the standard shape), `helmet` (HSTS only when `COOKIE_SECURE`), `cors` restricted to `CORS_ORIGIN`, and pino-http serializers logging only id/method/path/status. 61 tests pass. Stopped three leftover smoke-test servers from earlier tasks.

---

## 23. Phase 3 — Task 8: Web scaffold + login page

```text
next
```

**Response:** Added the `web` workspace (Vite 8, React 19, MUI 9, React Router 8, TanStack Query, Vitest + jsdom + Testing Library, react-hooks lint rules). TDD: failing RTL tests (login → `/employees`, `?next=` return, three open-redirect attempts ignored, generic 401 alert, protected-route redirect with `next`, valid session, sign out); then the API client (credentials, error shape, network error), `useMe`/`useLogin`, `safeNext`, `RequireAuth`, app bar with sign out (clears all cached data), login page. Fixed an immediate `/me` refetch after login (5-min `staleTime`) and made a failed background refetch not blank the page. Smoke-tested login through the Vite proxy against the test DB; production build compiles. README Setup/Run/Test filled in. 70 tests pass.

---

## 24. Phase 3 — Task 9: Money and status helpers

```text
next
```

**Response:** TDD: failing unit tests (12 accepted/rejected amount formats, half-up monthly split incl. the half-cent case, T17 `today()` in Asia/Kolkata incl. the 18:30 UTC midnight switch while the process runs in Los Angeles, status boundary on the last working day, invalid `APP_TIMEZONE`); then `positiveAmount`/`nonNegativeAmount` zod schemas (plain decimal strings fitting NUMERIC(14,2)), integer-cent `annualToMonthly`, `createClock(timeZone)` with `today()` via `Intl.DateTimeFormat('en-CA')`, `employeeStatus`, and `APP_TIMEZONE` config. 104 tests pass.

---

## 25. Phase 3 — Task 10: Create employee API

```text
next
```

**Response:** TDD: failing tests for the create schema (normalisation, every missing field, 9 invalid values, unknown fields), the service with fake repositories (derived currency/status, `hire` change effective on hire date with full snapshot, default/HR note, unsupported country and future hire date write nothing), the endpoint (201, duplicate code/email → 409, 400 paths, unsupported country, 401), atomicity (failing hire-change insert leaves no employee) and the append-only trigger; then migration `0002` (employees with checks + indexes incl. trigram search, `employee_changes` + `reject_modification()` trigger), repositories, service, route and PG unique-violation → `DUPLICATE` mapping. Fixed malformed amounts reporting two errors (refine → pipe). 133 tests pass; migrated the app DB.

---

## 26. Phase 3 — Task 11: List employees API

```text
next
```

**Response:** TDD: failing integration tests on a 5-employee, 4-currency fixture (default page sorted by name with INR and rates date, pagination incl. past the end, sort by converted salary asc/desc, USD conversion with exact expected values, 7 filter combinations, SQL status = `employeeStatus()`, search by name/full name/code/email and a literal `%`, 5 validation errors); then `listEmployeesQuery`, a repository query with whitelisted ORDER BY, parameters added only when used, trigram-index search expression, LIKE escaping, conversion `round((base+allowances) × rate_from ÷ rate_to, 2)`, separate count, and `ratesInfo` (oldest rate date + unknown-currency check). 155 tests pass.

---

## 27. Phase 3 — Task 12: Deterministic seed

```text
next
```

**Response:** TDD: failing tests for `mulberry32` (same seed → same sequence), the generator (deterministic first/last rows + checksum, seed changes output, sequential codes, unique emails, every row accepted unchanged by the create schema, date order, status mix, all countries/departments) and `seedDatabase` (counts of employees/hire/exit changes, snapshot currency matches country, refuses without reset, keeps an existing admin); then PRNG, generator, batched `unnest` seeding in one transaction and `npm run seed [-- --reset]`. Seeded the app DB: 10,000 employees + 10,675 history entries in 1.72 s (empty) / ~1.3 s (reset). Checked search: trigram index 5 ms vs planner's 19 ms seq scan at 10k (both fine). Refactored seed snapshot to named fields. Logged D-045. 168 tests pass.

---

## 28. Phase 3 — Task 13: Employees list page

```text
next
```

**Response:** TDD: failing tests for `GET /api/employees/filter-options` and 8 RTL tests (default query, country/department/title/status filters from page 1 with URL state, debounced search sending one request, header sort asc/desc on converted salary, next page, currency switch with header label, 401 → login with `next`). Then the filter-options query, a shared QueryClient (401 → login, no 4xx retries), `formatMoney` (en-IN grouping), and the list page with MUI X DataGrid in server mode. Smoke-tested on the seeded 10k DB: list queries 13–59 ms. Logged D-046. 177 tests pass. Slice C done.

---

## 29. Phase 3 — Task 14: Get + edit profile API

```text
next
```

**Response:** TDD: failing integration tests (detail with version/status/currency/country name, 404 for unknown and malformed ids, PATCH name/email bumps version and writes no history, stale version → 409 keeping newer data, unknown → 404, six audited fields refused with 400, duplicate email → 409, empty update and missing version → 400); then `updateProfileSchema` (strict: name/email only), `findById`, `updateProfile` (`UPDATE … WHERE id AND version` in a CTE joined to countries), service conflict-vs-not-found branching, and routes. 192 tests pass.

---

## 30. Phase 3 — Task 15: Detail, create and edit pages

```text
next
```

**Response:** TDD: failing RTL tests (create posts trimmed-blank-free body and opens the new employee; server 400 and 409 shown on their fields; detail shows profile and pay in local currency; profile edit sends the loaded version; version conflict explains and reloads; 404 message; list row opens detail; "Add employee" link), with `mockApi` handlers now receiving the request body. Then the create page, detail page with edit-profile dialog, shared `StatusChip`, `useFilterOptions`, `fieldErrors`, routes and row navigation. Found and fixed flaky web tests (timeouts under parallel jsdom load): `userEvent` without per-key delay, 3 s async waits, 15 s test timeout — 12/12 clean runs. 201 tests pass. Slice D done.

---

## 31. Phase 3 — Task 16: Change events and history API

```text
next
```

**Response:** TDD: failing unit tests for a pure `planChange()` (only changed fields recorded, equal amounts in different formats unchanged, no-op rejected, promotion as one event and snapshot, effective date not future and not before the latest change, relocation rules and new-currency snapshot, hire-date correction bounds, exited employees correction-only) and the change schema; integration tests for apply + record, stale version 409, relocation keeping the old currency in history (T14 API), 400 field errors, 404s, atomic rollback, and history newest-first with author and snapshot. Then `planChange`, `changeEventSchema`, row lock (`FOR UPDATE`), whitelisted dynamic SET, date bounds, history query, and routes. 232 tests pass.

---

## 32. Phase 3 — Task 17: Change dialog and history timeline

```text
next
```

**Response:** TDD: failing RTL tests (history newest first with type, date, note, old → new lines in the right currency, and author; Save disabled until the note has 5+ chars; promotion posts the loaded version without `countryCode`/`hireDate` and refreshes history; relocation clears pay, asks for a new country, relabels amounts in its currency and stays disabled until both amounts are entered; server field error shown in the dialog). Then `HistoryList`, `ChangeDialog` (pre-filled current values, relocation/correction-only fields, exited → correction only) and the detail page's History section. Refactored the shared version-conflict alert. 237 tests pass. Slice E done.

---

## 33. Phase 3 — Task 18: Exit and withdraw API

```text
next
```

**Response:** TDD: failing unit tests for pure `planExit` (hire ≤ notice ≤ last working day, notice not future and not before the latest change, immediate and back-dated exits allowed, no second exit) and `planWithdraw` (only while on notice), plus schema tests; integration tests for resignation (on notice, `exit` history entry, list `status` filter), back-dated termination (exited), stale version 409, 400 field error, withdrawal (active again, fields cleared, `exit_withdrawn` effective today) and nothing-to-withdraw. Implemented `POST /employees/:id/exit` and `/exit/withdraw` sharing one locked-transaction helper; fixed my test fixtures that lacked `exitType`. Refactored shared `invalidField`/`withStatus` helpers. 258 tests pass.

---

## 34. Phase 3 — Task 19: Exit and withdraw dialogs

```text
next
[Request interrupted by user]
Continue
```

**Response:** TDD: failing RTL tests (on-notice employee shows exit type, dates and "60 days" notice period with only "Withdraw exit"; exited shows no exit actions; record-exit dialog shows "Last working day must be on or after the notice date" and disables Save, then "Notice period: 60 days", posts the exact body and shows "On notice"; withdraw needs a note, posts `{version, note}` and shows "Active"). Then `daysBetween` (UTC), `ExitDialog`, `WithdrawExitDialog`, status-dependent buttons and exit details on the detail page. Refactored all dialogs onto a shared `useEmployeeEvent` hook and `saveErrors` helper. 262 tests pass. Slice F done.

---

## 35. Phase 3 — Task 20: Countries and exchange-rates API

```text
next
```

**Response:** TDD: failing unit tests for pure `planRateChange` (old → new values, INR fixed at 1, no future rate date, unchanged rejected) and the rate schema (> 0, ≤ 6 decimals); integration tests for `GET /api/countries`, `GET /api/exchange-rates`, `PUT /api/exchange-rates/:currency` (rate + date + who, history row in the same transaction), immediate effect on conversions (EUR → USD = 68,800.00 with USD at 90), history filtered by currency newest first, INR/zero/future rejections writing no history, 404 for unknown currency, and the append-only trigger. Implemented the `rates` module and migration `0003`; migrated the app DB. 282 tests pass.
