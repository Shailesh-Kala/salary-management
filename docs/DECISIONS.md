# Decisions Log

Every meaningful decision: what, alternatives considered, why, and the trade-off.

## D-001 — Monorepo, single GitHub repo
- **What:** Backend, frontend and docs live in one public repo `salary-management`.
- **Alternatives:** Separate repos for API and UI.
- **Why:** The code is submitted as a single unit for assessment review, so one repo keeps everything (code, docs, history) in one place for the reviewer. Also gives one CI pipeline and atomic commits across API + UI.
- **Trade-off:** Slightly more complex CI paths if the two halves grow independently.

## D-002 — Node.js 24.21.0
- **What:** Pin Node 24.21.0 (current LTS line) via `.nvmrc`; `engines` will be added to `package.json` when it is created.
- **Alternatives:** Stay on Node 18 (end of life since April 2025) and pin Vitest to v3; Node 22 LTS.
- **Why:** Supported LTS, compatible with current Vitest, chosen by the project owner.
- **Trade-off:** Contributors and CI must use Node 24; older local installs need `nvm use`.

## D-003 — Store salaries in local currency; convert via HR-maintained USD rates
- **What:** Salaries stored in the employee's country currency. One exchange-rate table (`units_per_usd`) maintained by HR; cross-currency conversion goes through USD at query time.
- **Alternatives:** Store everything in USD; fetch live rates from an FX API.
- **Why:** Local currency is the contractual truth and never drifts. Manual rates keep the system offline, deterministic and auditable.
- **Trade-off:** Comparisons are only as fresh as the last rate update; no historical-rate reporting.

## D-004 — CSV only for import/export (no native .xlsx)
- **What:** Import and export CSV with a published template; all-or-nothing import.
- **Alternatives:** `.xlsx` via a spreadsheet library.
- **Why:** Excel reads and writes CSV natively; avoids a heavy parser dependency and workbook edge cases (formulas, merged cells, multiple sheets).
- **Trade-off:** HR has to "Save As CSV" once; no formatting is preserved.

## D-005 — Salary history table doubles as the salary audit log
- **What:** Current salary on the employee row; every change appends an immutable history row (old/new, who, when, effective date, reason, source).
- **Alternatives:** Generic JSON audit log for all entities; effective-dated salary rows only (no current salary on the employee).
- **Why:** One table serves audit, history UI and past-month slips. Current salary on the employee row keeps list and insight queries to a single table.
- **Trade-off:** Current salary is denormalised and must be written in the same transaction as the history row. Non-salary edits are not audited (open question OQ2).

## D-006 — Slips computed on demand, printed by the browser
- **What:** Slip built from the salary in effect at month end; HTML view, browser "Save as PDF"; not stored.
- **Alternatives:** Server-side PDF generation; storing generated slips.
- **Why:** No PDF dependency; slips are reproducible from history, so storage adds nothing.
- **Trade-off:** No stored slip archive; layout depends on the browser's print rendering.

## D-007 — Flat per-country estimated deduction on slips
- **What:** Deductions = gross × country `deduction_rate`, labelled as an estimate.
- **Alternatives:** Real per-country tax engines; no deductions at all.
- **Why:** The brief asks for a breakdown, not payroll. Real tax rules are out of scope.
- **Trade-off:** Net pay is indicative only (open question OQ1).

## D-008 — Single HR role
- **What:** All HR users have the same permissions; accounts created via seed/CLI.
- **Alternatives:** RBAC (viewer/editor/admin), self-signup.
- **Why:** One persona in the brief; a smaller auth surface to secure and test.
- **Trade-off:** No least-privilege separation between HR users.
