# Study questionnaires implementation handoff prompt

Implement the runbook at `C:/Users/hexel/repos/neighborhood-walk-audit/docs/study-questionnaires-implementation-runbook.md`.

Read applicable repository instructions, then that runbook and its linked implementation plan and AARP question catalog. The runbook is the complete handoff; do not assume access to the previous conversation or repeat the completed research. The implementation has not started.

Work in both repositories:

- Frontend: `C:/Users/hexel/repos/neighborhood-walk-audit`
- Shared API: `C:/Users/hexel/repos/DallasUrbanists/cloud-api-server`

Use a 150-minute implementation cap, including preflight, integration, verification, and final handoff. Preserve existing changes, especially the API's Overpass fixes and unrelated work. Obtain normal scoped tool access for API edits if needed; the API changes are part of the authorized implementation.

Implement the full scope: study-owned editable/custom questionnaires per allowed audit type, point audits, optional zero-to-three photos, compact mobile forms, full-viewport map overlays, maximum supported pin zoom, all studies grouped Your studies then Other studies, two-pin shortest-distance street routes, and immutable types for every submitted audit. The first route pin snaps to an intersection; the second can end midblock. Apply type immutability in the UI and every API/edit-draft path. Preserve historical audits/reports, private draft ownership, optimistic concurrency, route-aware coverage, and data on failure.

Follow the runbook's contracts, ordered checkpoints, compatibility policy, and acceptance matrix. Use local/shared-API fixtures, not the legacy preview or a production-connected database, to verify new behavior. Run the specified focused tests, builds, documentation checks, and viewport/map/browser checks; distinguish simulations and unavailable device/PostgreSQL checks from actual passes.

This task ends with tested source changes, additive migration files, and a release handoff. Do not deploy, apply production migrations, commit, push, or open a PR unless separately instructed. At the cap, report exactly what passed, what remains incomplete or unverified, changed files by repository, elapsed time, and the next required action. Do not silently omit requirements or claim completion while required checks fail.
