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
