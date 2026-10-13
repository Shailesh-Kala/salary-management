# Prompt Log

Each user prompt, the phase it belongs to, and a 1–2 line summary of the response, in the same words and order as the reply in the chat.

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

**Response:** Created the public repo `salary-management` and pushed 8 commits, one per file (.gitignore, README skeleton, CLAUDE.md with the working rules, prompt log, requirements/architecture/plan skeletons, decisions log); raised that Node 18 is end-of-life and suggested a real Postgres test database.

---

## 2. Phase 0 — Repo setup (follow-up)

```text
The reason for single repo is we will be sending the code for assessment review so we don't need seprate repo.
1. Node version: please update the node version to 24.21.0
2. Yes already have database which I will config on .env file by myself
```

**Response:** Updated D-001's reason (one repo for the assessment review), installed Node 24.21.0 as the default and pinned it in `.nvmrc` (D-002), and noted you'll put the database connection in `.env` yourself.

---

## 3. Phase 1 — Requirements

```text
next
```

**Response:** Wrote REQUIREMENTS.md: 7 features including 6 pay-insight questions, multi-currency via HR-maintained rates, salary history, gross slip, CSV import/export, an out-of-scope list and performance targets; logged D-003 to D-008 and asked 7 open questions with defaults.

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

**Response:** Added resignation and notice period with derived statuses, a required note on every pay/title change, CSV/Excel/PDF export, and applied your answers (gross-only slips, wider audit, INR default, update by code, no deployment); disagreed on PDFs over 1,000 rows and asked OQ8 and OQ9.

---

## 5. Phase 1 — Requirements (open questions OQ8–OQ9)

```text
Q8. Let's only accept to CSV format and give user to an template on which there will be pre defined example values with headers and we need to put validation on the file size and how many rows will be accepted and rejected that report should be available to user as we can put the import in the queue in the background job
Q9. Let's make it 1000 rows at a time and if user wants more then suggest that it will it will be sended over email and ask for the email on which user want the export value and these process will be in the background queue
```

**Response:** Made import CSV-only from a template with example rows, size and row limits, and a background job with an accepted/rejected report; large PDFs go by background job and email; disagreed on email attachments (OQ10) and checked partial vs all-or-nothing import (OQ11).

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

**Response:** Emailed exports now go only to the requester's own address, with a login-protected link that expires in 24 h (file deleted, downloads audited); import gets a preview with "Import valid rows" or "Cancel"; listed T1 to T7 as required tests for Phase 3.

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

**Response:** Added safe retries (row result saved in the row's transaction, email never re-sent; T8, T9), one active import across all HR users (D-021, T10), removed "project owner wants" from every reason, and reworded D-014.

---

## 8. Phase 2 — Design

```text
Next
```

**Response:** Wrote ARCHITECTURE.md (diagrams, data model, about 40 endpoints, folder structure, security/performance/reliability decisions) and PLAN.md with 38 test-first tasks; logged D-022 to D-030 and flagged the main choices to check.

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

**Response:** Email links now open the app page `/exports/:id` (T11), previews expire after 24 h with raw data cleared (T12, T13), relocation became an audited change type (T14), and the plan was reordered into 13 usable slices, plus the CSRF wording, rate history and tsconfig flags.

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

**Response:** Added an import row-rules table (hire on the hire date, name/email without history, hire date and exited employees only via correction), per-row error isolation, sessions that end immediately, and IST "today" with dates as text; added tests T15 to T18.

---

## 11. Phase 3 — Task 1: Workspace scaffold

```text
next
```

**Response:** Task 1: npm workspace with TypeScript 6.0 (the linting plugin doesn't support 7 yet, D-040), ESLint, Prettier, Vitest and `.env.example`; lint, typecheck and test all run, and the web workspace waits for Task 8.

---

## 12. Phase 3 — Task 2: CI

```text
Next
```

**Response:** Task 2: added the GitHub Actions workflow with a Postgres 16 service; GitHub didn't start the job because of an account billing lock, though the same steps passed locally.

---

## 13. Phase 3 — Task 2: CI (re-run)

```text
run CI workflow now
```

**Response:** Re-ran CI after the billing lock cleared; it passed end to end, and the later blocked run passed too.

---

## 14. Phase 3 — Task 3: App skeleton

```text
next
```

**Response:** Task 3: environment checks, request IDs, the standard error format and `/health`, with 10 tests; noted the request logs were too detailed until Task 7.

---

## 15. Phase 3 — Between tasks 3 and 4 (question)

```text
what is TEST_DATABASE_URL why do we need?
```

**Response:** Explained TEST_DATABASE_URL: a separate database the tests empty and refill so your real data is never touched, with a safety check promised in Task 4.

---

## 16. Phase 3 — Between tasks 3 and 4 (SMTP config)

```text
I am using mailtrap Sandbox test email cred can we add email username and password and port on the .env example
```

**Response:** Added the Mailtrap Sandbox SMTP host, port, username and password to `.env.example` (Mailpit kept as a no-login option) and updated the docs.

---

## 17. Phase 3 — Task 4: Database and test harness

```text
Done, Next
```

**Response:** Task 4: created the missing app database, then the connection pool (UTC, dates as text), transactions, SQL migrations with countries and the rate snapshot, the test-database guard and the database health check; noted your local Postgres is 14.3.

---

## 18. Phase 3 — Task 5: Password hashing

```text
next
```

**Response:** Task 5: scrypt password hashing (about 96 ms per check) with salted hashes that record their settings; a bad stored hash returns false instead of crashing.

---

## 19. Phase 3 — Task 5 follow-up (review notes)

```text
Looks good, thanks. A few small things:
- Please confirm verify and hash use async crypto.scrypt, not scryptSync, so a login doesn't block the server.
- The login limit is per IP + email, so one IP can try many different emails. In Task 7, please also add a per-IP limit (say 20/min) no matter which email is used.
- When a stored hash is malformed, log a warning (without the hash) so we notice bad data, while still returning false.
```

**Response:** Confirmed hashing is async, added a warning log for bad stored hashes, and put a 20-per-minute per-IP login limit into Task 7 (D-042).

---

## 20. Phase 3 — Task 6: Login, logout, me, revocation, user CLI

```text
next
```

**Response:** Task 6: login, logout and `/me` with an 8-hour HttpOnly cookie, sessions that end immediately on logout or disable (T16), and user create/disable commands; asked whether you wanted a reset-password command.

---

## 21. Phase 3 — Task 6 follow-up (review notes)

```text
Before "next":
- Yes, please add user:reset-password. Disable + create doesn't work because the email is still taken by the disabled account, and it would split the person's history across two user IDs. Generate a new password, print it once, and bump token_version. Please add user:enable too.
- Is the cookie's Secure flag controlled by COOKIE_SECURE? Safari may not store Secure cookies on http://localhost, so login would look fine but every request after it would fail.
- A disabled user's login should give the same generic 401, with the same timing as a wrong password.
- Make the log parameter of verifyPassword required now that login passes it.
```

**Response:** Added `user:reset-password` and `user:enable` (D-044), confirmed COOKIE_SECURE controls the Secure flag (with a test), proved a disabled user's login looks like a wrong password, and made the log parameter required.

---

## 22. Phase 3 — Task 7: Security middleware

```text
next
```

**Response:** Task 7: both login limits, a 300-per-minute API limit, security headers, CORS and slimmed request logs; stopped three leftover test servers from earlier tasks.

---

## 23. Phase 3 — Task 8: Web scaffold + login page

```text
next
```

**Response:** Task 8: the web app with login, the `?next=` return (safe from open redirects), sign-out that clears cached data, and protected routes. Slice B done.

---

## 24. Phase 3 — Task 9: Money and status helpers

```text
next
```

**Response:** Task 9: amount validation, annual-to-monthly rounding to the cent, "today" in IST (T17) and the derived employee status.

---

## 25. Phase 3 — Task 10: Create employee API

```text
next
```

**Response:** Task 10: create-employee API with the employees and append-only history tables, a hire entry with a full snapshot, and 409 for duplicates; asked about future hire dates.

---

## 26. Phase 3 — Task 11: List employees API

```text
next
```

**Response:** Task 11: employee list API with paging, sorting (including by converted salary), filters, search and currency conversion.

---

## 27. Phase 3 — Task 12: Deterministic seed

```text
next
```

**Response:** Task 12: deterministic seed of 10,000 employees in about 1.3–1.7 s with a `--reset` guard (D-045); your app database is now seeded.

---

## 28. Phase 3 — Task 13: Employees list page

```text
next
```

**Response:** Task 13: employees list page with a server-side grid, filters, search, currency switch and expired-session redirect; queries take 10–59 ms on 10k rows. Slice C done.

---

## 29. Phase 3 — Task 14: Get + edit profile API

```text
next
```

**Response:** Task 14: get-employee and edit-profile (name and email) with optimistic locking; a stale version gets 409.

---

## 30. Phase 3 — Task 15: Detail, create and edit pages

```text
next
```

**Response:** Task 15: employee detail page, create form and profile-edit dialog with a version-conflict prompt; found and fixed flaky web tests. Slice D done.

---

## 31. Phase 3 — Task 16: Change events and history API

```text
next
```

**Response:** Task 16: audited change events (raises, promotions, relocations, hire-date corrections) and the history API, with the rules in a pure, unit-tested function.

---

## 32. Phase 3 — Task 17: Change dialog and history timeline

```text
next
```

**Response:** Task 17: record-change dialog (with relocation and correction fields) and the history timeline on the employee page. Slice E done.

---

## 33. Phase 3 — Task 18: Exit and withdraw API

```text
next
```

**Response:** Task 18: exit and withdraw API with date-order rules, history entries and the status filter.

---

## 34. Phase 3 — Task 19: Exit and withdraw dialogs

```text
next
[Request interrupted by user]
Continue
```

**Response:** Task 19: exit and withdraw dialogs with the notice period shown in days, and buttons that depend on status. Slice F done.

---

## 35. Phase 3 — Task 20: Countries and exchange-rates API

```text
next
```

**Response:** Task 20: countries and exchange-rate API with an append-only, audited rate history; new rates apply to conversions immediately.

---

## 36. Phase 3 — Task 21: Exchange rates page

```text
next
```

**Response:** Task 21: exchange-rates page with edit and history, plus app navigation; capped web test workers at 2 to fix a flaky run. Slice G done.

---

## 37. Phase 3 — Task 22: Insights API Q1–Q3

```text
next
```

**Response:** Task 22: insights Q1–Q3 (headcount and payroll, pay by country, pay by department) computed in SQL, 10–94 ms on 10k rows.

---

## 38. Phase 3 — Task 23: Insights API Q4–Q5

```text
next
```

**Response:** Task 23: insights Q4 (pay range by job title in a country) and Q5 (people outside 80–120% of their peers' median), 16–92 ms; asked about a minimum peer-group size.

---

## 39. Phase 3 — Task 24: Insights API Q6–Q7

```text
next
```

**Response:** Task 24: insights Q6 (recent pay and title changes) and Q7 (who is leaving); offered to seed raises and promotions because Q6 was empty.

---

## 40. Phase 3 — Task 25: Insights page

```text
next
[Request interrupted by user for tool use]
continue with the task
```

**Response:** Task 25: Insights page answering all seven questions with filters kept in the URL; redid the checks in smaller steps after the interrupted command. Slice H done.

---

## 41. Phase 3 — Task 26: Slip API (JSON)

```text
next
```

**Response:** Task 26: monthly slip API using the salary in effect at month end, gross pay only, with employment-month rules (T14 slip part).

---

## 42. Phase 3 — Task 27: Slip PDF

```text
next
```

**Response:** Task 27: slip as a PDF download, checked visually; amounts show currency codes because the built-in font has no ₹ (D-047).

---

## 43. Phase 3 — Task 28: Slip page

```text
next
```

**Response:** Task 28: slip page with month picker, print view and PDF download. Slice I done.

---

## 44. Phase 3 — Task 29: CSV and Excel export API

```text
next
```

**Response:** Task 29: CSV and Excel export streamed in 0.4–0.7 s for 10k rows, with formula escaping and an audit row; overrode exceljs's `uuid` to clear an advisory (D-048).

---

## 45. Phase 3 — Task 30: Direct PDF export

```text
next
```

**Response:** Task 30: direct PDF export of up to 1,000 rows (422 above that); asked about digit grouping for non-INR currencies.

---

## 46. Phase 3 — Task 31: Export menu

```text
next
```

**Response:** Task 31: export menu on the employee list for CSV, Excel and PDF, explaining an oversized PDF. Slice J done.

---

## 47. Phase 3 — Seeded pay history and digit grouping (between tasks 31 and 32)

```text
1. Yes, add seeded raises and promotions. Deterministic annual reviews for most employees, some promotions with title changes, and a few relocations, all within the last year.

2. Yes, Indian grouping for INR and international grouping (1,234,567.89) for every other currency, including EUR. Please keep this for display only (UI and PDF). CSV and Excel must keep plain numbers with no grouping, so Excel can calculate with them and the CSV can be re-imported.
```

**Response:** Added seeded annual reviews, promotions and relocations from the last year (D-050), and Indian grouping for INR only with international grouping elsewhere, display only (D-049); re-seeded the app database.

---

## 48. Phase 3 — Task 32: Job queue and worker

```text
next
```

**Response:** Task 32: PostgreSQL job queue and worker with leases, retries with backoff and graceful shutdown (checked with a real SIGTERM).

---

## 49. Phase 3 — Task 33: Import template, upload checks, one active import

```text
next
```

**Response:** Task 33: import template, upload checks and the one-active-import rule (T10); a lint slip reached one commit because checks were chained with `;`, CI caught it and it's fixed.

---

## 50. Phase 3 — Prompt log review

```text
that's create I just check the Prompt and resonse and I found the response is not matching what I can see in the chat and in the document
```

**Response:** Rewrote every Response in this log as a 1–2 line summary matching my chat reply (your choice: "1–2 line chat summary"), and will keep that format from now on.

---

## 51. Phase 3 — Question about "failing" in the Task 33 response

```text
I want come back to the response I see earlier was: [the old Task 33 response] there are couple of things failing which should be clear out? or is there later on the plan?
```

**Response:** Nothing is failing: "failing tests" meant the test-first step (tests written before the code), all 408 tests, lint, typecheck and CI pass, and the one lint failure was fixed in the next commit; the rest of import is planned in Tasks 34–37.

---

## 52. Phase 3 — Task 34: Import validation and preview

```text
Next
```

**Response:** Task 34: the validation job checks every row with the import rules (T18), stores a preview with exact counts (T1), offers the rejected rows as a CSV that can be fixed and re-uploaded (T3), and schedules the 24-hour expiry; closes the "stuck in validating" gap.

---

## 53. Phase 3 — Task 35: Import cancel, confirm and apply

```text
next
please continue with task as I have added credits
```

**Response:** Task 35: cancel (any HR user, writes nothing — T2) and confirm (records who confirmed, queues the apply); the apply job writes each row in its own transaction with history from the import (T7, T14), re-checks rows, retries safely after a lost connection (T8) and rejects only a row that fails unexpectedly (T15).

---

## 54. Phase 3 — Task 36: Preview expiry and data clearing

```text
next
```

**Response:** Task 36: previews expire after 24 h (confirm returns 410 even before the expiry job runs, and an overdue preview never blocks a new upload — T12); a database trigger clears the file and raw rows whenever an import ends, and an import whose job keeps failing is now marked failed (T13).
