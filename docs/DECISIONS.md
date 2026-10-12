# Decisions Log

Every meaningful decision: what, alternatives considered, why, and the trade-off.

## D-001 — Monorepo, single GitHub repo
- **What:** Backend, frontend and docs live in one public repo `salary-management`.
- **Alternatives:** Separate repos for API and UI.
- **Why:** One reviewer, one CI pipeline, atomic commits across API + UI.
- **Trade-off:** Slightly more complex CI paths if the two halves grow independently.
