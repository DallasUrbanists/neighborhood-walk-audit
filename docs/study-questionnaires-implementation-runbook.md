# Study questionnaires implementation runbook

## Objective and execution boundary

Implement study-owned questionnaires, point and two-pin routed street audits, immutable submitted audit types, optional photos, the compact mobile layouts, and an all-studies dashboard across the existing frontend and shared API, with a **150-minute execution cap**.

This runbook is the execution handoff for the [implementation plan](./study-questionnaires-implementation-plan.md). Read the [56-question catalog](./aarp-question-catalog.md) for the complete prepared question wording, sources, answer options, and default selections. Do not repeat the AARP research. The [migration notes](./google-cloud-migration.md) describe the deployment architecture; [journey rehearsals](./user-journey-rehearsals.md) document existing behaviors and regressions to preserve.

The requested implementation has not been performed. Source files and existing test harnesses were inspected while preparing this runbook; feature tests, migrations, builds, and browser checks listed below are instructions for the executor, not completed evidence. Planning-document validation does not establish application correctness.

The delivery boundary is source changes, additive SQL, focused tests, build output, and a release handoff. Production SQL execution, deployment, commits, pushes, and pull requests are not part of this implementation instruction. Continue authorized local implementation without repeatedly seeking confirmation. Follow actual tool permission requirements, especially for the API checkout outside the frontend workspace.

## Workspace and reading order

| Item | Absolute location |
| --- | --- |
| Frontend working directory | `C:/Users/hexel/repos/neighborhood-walk-audit` |
| Shared API working directory | `C:/Users/hexel/repos/DallasUrbanists/cloud-api-server` |
| This runbook | `C:/Users/hexel/repos/neighborhood-walk-audit/docs/study-questionnaires-implementation-runbook.md` |
| Detailed plan | [study-questionnaires-implementation-plan.md](./study-questionnaires-implementation-plan.md) |
| Prepared question bank specification | [aarp-question-catalog.md](./aarp-question-catalog.md) |
| Original mobile reference if still available | [DuckDuckGo screenshot](C:/Users/hexel/AppData/Roaming/Code/agentSessionData/1ce91a1d-8b35-4641-9bf1-38390d67a6bd/attachments/bd46ef21-27fb-41d6-8a52-870063b854e9/Screenshot_20261107_221210_DuckDuckGo.jpg) |

Read applicable parent/repository instructions, this runbook, then the catalog. Consult the detailed plan for additional rationale; the steps below contain the required implementation contracts. Local cross-repository links assume the directory arrangement above. If paths have moved, find the matching checkout before making changes.

At handoff preparation, frontend changes consisted of the untracked planning documents. The API was at `bb31284` and already had a modified [walkAuditGeospatial.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditGeospatial.ts), three untracked walk-audit migration/handoff documents, and the unrelated [postiz-queue/](../../DallasUrbanists/cloud-api-server/gcp/postiz-queue) directory. Preserve all of these and inspect the current status again; the preparation snapshot is not permission to reset subsequent work. In particular, retain the Overpass GET transport, identifying user agent, provider order/configuration, and 55-second attempt allowance.

The API may require a scoped write approval in an executor whose sandbox only permits writes to the frontend checkout. The user has authorized the API portion of this task; use the normal tool approval mechanism for that exact path. Do not silently move the chat workspace or discard local API changes to obtain access. If access remains denied, finish independent work and report the smallest blocked portion.

## Acceptance criteria

| ID | Required observable result |
| --- | --- |
| A01 | A normal registered author enables any of the seven nonempty combinations of intersection, street-segment, and point. Each enabled type has 1-30 questions. |
| A02 | The author selects individual bank questions, changes wording/options/required flags/order, removes questions, and adds entirely custom questions. Each study/type saves its final definition permanently. |
| A03 | Contributors answer the study's assigned questionnaire automatically. No participant worksheet selection remains in shared mode. Templates and bank updates cannot change previously created studies. |
| A04 | Point audits retain a Point at the selected position along a known street edge after saving, resuming, public viewing, and editing. |
| A05 | Street audit creation and location editing use two endpoints: A snaps to an intersection; B snaps to a street and may be midblock. The selected route is the shortest distance through the saved study network. |
| A06 | Every submitted audit's type is immutable through the UI, direct PATCH, edit-draft PATCH, and edit submission, including staff calls. New unsubmitted drafts may still change type. |
| A07 | An audit can be created with zero to three photos. Draft images are owner-private, submitted images are public, and the server enforces size/type/count independently of the browser. |
| A08 | Sign-in, audit type selection, questions, and review fit the reference mobile viewports without page scrolling, including errors, long content through pagination, and three photos. |
| A09 | Study boundary drawing and intersection/street/point pinning maps fill the visible web viewport behind all controls, with no horizontal/vertical page or overlay scrolling. Map pan and zoom remain usable. |
| A10 | All audit pin screens start at the current tile layer's highest supported zoom, currently 19, at the saved/current/fallback position. Late GPS and resize events do not override manual interaction. |
| A11 | The dashboard shows all public studies under Your studies followed by Other studies, with correct membership, counts, stable ordering, and independent pagination. |
| A12 | Existing audit answers, worksheet IDs, feature IDs, identities, and report snapshots remain valid. Legacy single-edge audit locations remain unchanged until explicitly replaced. |
| A13 | Progress counts route coverage across every traversed edge, unions overlapping intervals, distinguishes partial coverage, and never treats a point or a passed junction as a completed street/intersection audit. |
| A14 | Failed generation/submission rolls back; versioned autosaves, private drafts, account switching, shared deep links, and existing Leaflet teardown safeguards continue working. |

The clarified dashboard entity is **studies**, not a feed of individual submitted audits. Published questionnaire editing, advanced answer types, photo changes during later audit editing, offline reconciliation, and standalone backend feature parity remain outside scope.

## Confirmed code and integration points

| Area | Existing code and required intervention |
| --- | --- |
| Frontend routing/auth | [app.js](../public/app.js): `boot`, `renderRoute`, `renderFirebaseLogin`, `updateHeader`. Shared mode comes from runtime configuration and Firebase authentication. |
| Study wizard | [app.js](../public/app.js): `studyWizardFrame`, `renderNewStudy`, `initializeBoundaryMap`, `createStudyFromWizard`. The boundary button currently creates the study; change it to advance to types/questions/review. |
| Audit wizard | [app.js](../public/app.js): `renderAuditWizard`, `auditWizardFrame`, `renderAuditWizardScreen`, `persistAuditDraft`, `renderAuditTypeStep`, `renderAuditLocationStep`, `initializeAuditLocationMap`, `renderWorksheetStep`, `renderQuestionStep`, `renderAuditReviewStep`, `renderAuditDetail`. Replace numeric-step assumptions consistently. |
| Maps | [app.js](../public/app.js): `createMap`, `replaceTileLayer`, `destroyMaps`, `scheduleMapResize`, `nearestStudyFeature`, `nearestPointOnSegment`, `initializeStudyMap`. Keep renderer teardown/resize guards. |
| Adapter | [shared-api.js](../public/shared-api.js): `request`, `list`, `studyView`, `worksheetView`, `auditView`, `serialize`, dashboard/study/draft dispatch, `resumeDraft`, `clear`. It currently filters the dashboard, maps a single feature, and rewrites every 409 message. |
| Styles and shell | [styles.css](../public/styles.css), [index.html](../public/index.html): header/main padding, large headings/cards, map minimum heights, bottom trays, viewport metadata. Preserve browser zoom and existing 52-pixel touch targets. |
| Build | [build-static.js](../scripts/build-static.js) copies all public assets. [shared.json](../config/shared.json) selects the live API; the standalone server remains legacy. |
| API definitions | [walkAudit.ts](../../DallasUrbanists/cloud-api-server/src/models/walkAudit.ts), [walkAuditValidation.ts](../../DallasUrbanists/cloud-api-server/src/utils/walkAuditValidation.ts): type union, `auditType`, `validatePrompts`, `validateAnswers`, field allowlists. Shared prompts are choice/text with string answers. |
| API study/templates/DTOs | [walkAuditService.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditService.ts): `worksheetInput`, worksheet CRUD, `createStudy`, `studyDto`, `draftDto`, `auditDto`, `reportDto`, `organizer`, `lockStudy`, `version`. Keep DTOs pure; load assignments/photo metadata asynchronously before mapping. |
| API mutations/progress | [walkAuditWorkflows.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditWorkflows.ts): `completeAudit`, `partialDraft`, `mergedAudit`, `sqlAudit`, `createAudit`, `patchAudit`, `createDraft`, `patchDraft`, `submitDraft`, `calculateProgress`, `getProgress`, `capture`. Every write path needs enforcement. |
| API graph generation | [walkAuditGeospatial.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditGeospatial.ts): `extractWalkAuditNetwork`, `WalkAuditGenerator`. Stable IDs look like `way/10/1/2/0/0`; intersections look like `node/2`. The topology must not join arbitrary geometric crossings. |
| API HTTP | [walkAuditRoutes.ts](../../DallasUrbanists/cloud-api-server/src/routes/walkAuditRoutes.ts), [walkAuditController.ts](../../DallasUrbanists/cloud-api-server/src/controllers/walkAuditController.ts): private auth, pagination filters, path/UUID parsing, domain errors, route mounting. |
| API middleware | [app.ts](../../DallasUrbanists/cloud-api-server/src/app.ts): scoped JSON limits, media-type checks, opaque domain JSON, injected test auth. [cors.ts](../../DallasUrbanists/cloud-api-server/src/middleware/cors.ts) already permits PUT/DELETE/If-Match. |
| API SQL/tests/docs | [009_walk_audits.sql](../../DallasUrbanists/cloud-api-server/migrations/009_walk_audits.sql), [010_seed_walk_audit_worksheets.sql](../../DallasUrbanists/cloud-api-server/migrations/010_seed_walk_audit_worksheets.sql), existing `walkAudit*.test.ts`, [walkAudits.ts](../../DallasUrbanists/cloud-api-server/src/docs/walkAudits.ts). Add a new migration; do not rewrite historical SQL. |

New files to create are `public/question-bank.json`, `public/questionnaires.js`, `test/questionnaires.test.js`, API `src/services/walkAuditRouting.ts`, and API `tests/walkAuditRouting.test.ts`. A focused photo service/helper is reasonable if it keeps workflows readable. Use the next free migration number, provisionally `migrations/011_study_questionnaires_routes_photos.sql`; do not overwrite a newly appeared migration.

## Preflight and execution clock

Start the 150-minute clock when implementation begins, including preflight. Use task-specific variables if recording it in PowerShell:

```powershell
$walkAuditStartedAt = Get-Date
$walkAuditDeadline = $walkAuditStartedAt.AddMinutes(150)
```

Run these commands in the frontend directory, then the API directory. Read applicable instructions first and compare current code with the evidence above.

```powershell
git status --short
git diff --stat
node --version
npm --version
```

Use a Node version compatible with both packages: the frontend declares Node 20+, and the API declares Node 22.13+. Dependencies are assumed installed. If absent, install from each repository's existing lockfile without upgrading dependencies; include that time in the cap. Do not use a production-connected development server as a substitute for fixtures.

## Work sequence and checkpoints

| Elapsed time | Work | Required checkpoint |
| --- | --- | --- |
| 0-5 min | Preflight, catalog conversion, contract/fixture setup | Both working trees understood; no unrelated changes overwritten. |
| 5-28 min | Schema/backfill, study configuration, immutable-type enforcement, dashboard API | Assignment and edit invariants tested through service/HTTP fixtures. |
| 28-38 min | Point validation, type/filter changes, routing endpoint keys | Point geometry and topology fixtures work. |
| 38-63 min | Routing helper/preview/persistence/coverage | Shortest route, midblock endpoint, disconnected graph, and legacy tests pass. |
| 63-81 min | Study authoring wizard | All type combinations and edited/custom question submission work. |
| 81-105 min | Compact forms, map overlays/two pins, edit lock, dashboard groups | Required screens fit and route selection is usable. |
| 105-115 min | Adapter/resume/review/summary/error integration | Saved canonical types, prompts, routes, and newer answers survive reload/races. |
| 115-133 min | Photos API/client/display | Zero/three-photo journey and private/public access work. |
| 133-145 min | Focused tests, builds, browser acceptance | Record actual pass/fail/skipped evidence. |
| 145-150 min | Narrow corrections, diff review, handoff | Deliver scoped changes and explicit remaining gaps. |

Write focused tests as each feature is implemented; the final verification window is for running and integrating them, not inventing the entire test suite. Stop feature expansion at minute 133. Do not silently remove required behavior to fit the clock. A blocked or failing acceptance item remains incomplete at the cap.

## Phase 1 Prepare the catalog and contracts

1. Encode the catalog's 56 unique definitions as catalog version `aarp-topics-v1`: 16 intersection, 18 street, 18 point, and four shared. Including shared entries gives 20/22/22 eligible questions. Preserve the documented seven/eight/six default selections.
2. Each bank entry includes a stable source ID, eligible types, topic, prompt definition, and source metadata. Use existing choice/text prompts; text defaults to 2,000 characters and optional. Keep Not applicable distinct from Not observed / unsure.
3. In the questionnaire helper, clone selected definitions into independent study questions with fresh lowercase slug IDs. Preserve `sourceQuestionId` separately. Implement adding/removing/reordering, required flags, option editing, and validation without DOM coupling. Never mutate the bank.
4. IDs must be unique within a questionnaire, and choice values are the stored string options. All enabled types require 1-30 prompts; questionnaire keys must match allowed types exactly. Keep backend bounds authoritative.
5. Tests should check independent clones, common-question independence across types, duplicate IDs, empty/invalid selections, option removal, and retained edits when toggling a type off/on.

## Phase 2 Add schema and historical assignments

Use one additive migration, explicitly applied by fixtures/operator rather than server startup. In a transaction:

- Add worksheet `is_template boolean NOT NULL DEFAULT true`.
- Add `walk_audit_study_questionnaires`: `study_id` with cascade deletion, `audit_type`, pinned `worksheet_id` with restricted deletion, `catalog_version`, and object-valued `source_metadata`. Primary key `(study_id, audit_type)` defines the allowed types. Do not add a second database type array that can disagree with these rows.
- Add nullable object-valued `route_selection` JSONB to audits and drafts.
- Expand audit/draft type checks and worksheet recommendation checks to the three types. Also update the runtime `worksheetInput` recommendation-count limit from two to three.
- Add `walk_audit_photos`: UUID ID, study/creator, exactly one of draft/audit parent, slot 1-3, verified content type, byte count, nonempty image bytes, and timestamp. Constrain byte count to `octet_length(image_bytes)` and at most 2,097,152. Unique `(draft_id, slot)` and `(audit_id, slot)` enforce the limit. Use parent composite references or equivalent constraints to keep study/creator consistent; existing parent keys may need an additional unique key. Cascades delete photo bytes with their parent.

Backfill exactly two assignments per existing study, without enabling point automatically:

1. For each existing type, use its most recently created submitted audit's worksheet; break timestamp ties by the largest audit ID.
2. If there is no such audit, use the highest existing version of the explicit `intersection-observation` or `street-observation` default slug. Never assume numeric worksheet IDs.
3. If a needed default is missing, abort transactionally with an actionable message. Do not rewrite existing answers, worksheets, feature collections, report captures, or timestamps.

Migration fixtures must exercise empty and populated databases, unrelated rows, mixed historical worksheets, missing defaults, expanded checks, photo parent/count constraints, and deletion behavior. Update every existing fixture that currently applies only migrations 009 and 010, including the opt-in PostgreSQL fixture. Tests asserting an exact table count must reflect the two added tables.

## Phase 3 Enforce study questions and immutable types

### Study creation and reads

1. Extend study input to accept `allowedAuditTypes` and type-keyed `questionnaires`, each with `prompts` and `sourceMetadata`. Match the detailed plan's example; a source reference never replaces the final authored prompt.
2. Validate all fields, type combinations, question counts, IDs/options, and bounded provenance before reserving an Overpass generation attempt.
3. Generate the network outside the database transaction as today. In the final transaction, insert the study, one version-1 non-template worksheet per enabled type, and assignments. Roll back all three on failure.
4. For old create clients, omission of both new fields pins the two explicit default templates; omission of just one is invalid. All newly configured studies must have fixed assignments.
5. Keep global worksheet writes staff-only. Filter non-template copies out of global template lists, including version-history listings; block staff mutation routes from revising/promoting study-owned copies. Pinned worksheet reads remain available.
6. Enrich study detail with `allowedAuditTypes` and `questionnaires[type]` containing `worksheetId`, title, prompts, and provenance. Keep DTOs synchronous/pure; query assignments before DTO mapping. Capture the configuration in new reports as well.

### Shared mutation policy

Centralize study assignment, geometry, and answer validation so `completeAudit`, `partialDraft`, direct creation/PATCH, and draft submission agree. For an untyped blank draft, allow an empty answer object, not arbitrary unbound answers. On new-draft type change, derive the worksheet server-side and clear old answers/location/route. Reject a supplied worksheet that differs from the assignment.

Draft and submitted answers remain string-valued objects. Remove a cleared optional answer key rather than introducing null or array values into this API contract.

For an edit draft, load its persisted target audit and use that audit's type and pinned worksheet. A type key that is omitted or unchanged is acceptable; any different value returns `409 AUDIT_TYPE_IMMUTABLE` before mutating dependent state, including for staff. Recheck the target inside final submit. Do not trust the edit draft's type just because it was saved earlier.

Historical submitted audits retain their own pinned questionnaire and can edit answers against it. If a pre-upgrade edit draft has another type, preserve it for reference and offer a fresh edit draft from the original audit; never silently translate answers. Preserve study-first locking, draft ownership, and `expectedVersion`. The existing submit body remains only `{ expectedVersion }`; do not move final answers/photos into that request.

### Dashboard API

Add private `GET /api/walk-audits/dashboard?group=mine|other&limit=...&offset=...`. Derive the registered contributor from verified identity. Mine means creator OR at least one submitted audit; Other means neither. Include zero-audit studies. Use grouped counts/EXISTS in SQL, stable newest-first order and ID tie-break, with the existing page envelope. Return compact studies and counts, without geometry, private drafts, or per-study audit fetches. Validate `group` and update OpenAPI.

## Phase 4 Add point and routing geometry

### Point records

Point `featureId` is the parent saved street-edge ID; its GeoJSON is a Point, not that parent's LineString. Validate a finite in-boundary position within one meter of its named edge, project canonically, and keep GeoJSON/GPS consistent. Intersection selection remains the exact saved intersection Point. Add point to models, runtime validators, SQL checks, query filters, recommendation bounds, and OpenAPI together.

### Routing graph and preview

1. Build `walkAuditRouting.ts` as a pure graph/geometry helper. Read only the saved study network; do not fetch a new network per route.
2. Preserve OSM node connectivity. New feature properties expose endpoint keys, e.g. `fromNodeKey`/`toNodeKey`, while retaining existing IDs. For old `way/<way>/<from>/<to>/<occurrence>/<part>` features, combine source node IDs with normalized endpoint positions. This separates distinct boundary cuts around an outside node and prevents connections at unrelated coordinate crossings. Use the same key convention for `node/<id>` intersections. Normalize positions consistently, e.g. nine decimal places; do not join different source nodes by proximity.
3. Weight edges by physical length and run undirected Dijkstra with stable sorted adjacency/tie handling. A binary heap avoids quadratic search on the existing network limit of 10,000 features. Motor-vehicle one-way rules and external routing services are outside this walking-network change.
4. A must be a saved intersection. Project B onto its named edge inside the study; if mid-edge, add a temporary node and split that edge's distance. If B is at an actual node, reuse it. Store orientation-aware fractions against original coordinate order.
5. Reverse edge geometry as necessary when concatenating a continuous route. Reject coincident endpoints, disconnected components, invalid IDs, off-edge coordinates, and empty/zero-length routes. No straight-line fallback.
6. Add authenticated `POST /api/walk-audits/studies/:id/route-preview`. Input and response are specified below. Reuse the same authoritative helper for location-changing saves and final validation. Cache a graph only if keyed by the study/network version; never reuse one after boundary regeneration.

Endpoint intent:

```json
{
  "startIntersectionId": "node/42",
  "end": {
    "featureId": "way/10/42/43/0/0",
    "locationGps": { "longitude": -96.8, "latitude": 32.78 }
  }
}
```

These IDs/coordinates illustrate shape, not an actual matching fixture. The preview returns a `route` envelope containing `routeSelection` and canonical `geojson`. Canonical `routeSelection` contains the two endpoint fields, `edges: [{ featureId, fromFraction, toFraction }]` in traversal order, and `lengthMeters`. This same selection shape appears on saved draft/audit DTOs. Use `startIntersectionId` alone for a valid partial draft; a final submission requires both endpoints and a nonempty path.

### Persistence and coverage

Add `routeSelection` to field allowlists and DTOs. Incoming route intent contains endpoints only; derive its edge list, length, geometry, and anchor server-side. For routed streets, `featureId` remains the first traversed edge as a compatibility anchor, `locationGps` is the start intersection, and `geojson` is the complete LineString. Non-street types have no route selection. Never trust client-supplied shortest-path claims or derived geometry.

New street submissions require a complete route, including old-client direct POSTs. A persisted legacy street audit with null route selection may retain its original single-edge geometry when other fields change. Its location can only be replaced through a confirmed two-pin route, and a routed audit cannot downgrade to a legacy location. Old unsubmitted street drafts need a route before first submission; retain their answers for review.

Make request validation conditional on geometry mode: routed street input can omit derived `featureId`, `locationGps`, and `geojson`, because the server derives them from endpoint intent. If a client supplies derived claims, require agreement with the canonical result. An edit that omits route input retains the persisted route; explicit null cannot erase a routed location. The legacy exception comes from the saved target audit, never a caller-controlled flag.

Replace the distinct `(type, feature_id)` progress query with the metadata needed for route slices and actual point counts. Union intervals per base edge, normalizing reverse traversal with min/max fractions. Merge overlapping intervals and count an edge complete only when coverage reaches both ends within a documented rounding tolerance. Treat legacy single-edge audits as full-edge observations. Mark partial final edges separately. Do not count junction traversal as an intersection observation.

Only enabled finite types enter the coverage denominator. Point-only studies expose a point observation count and `overall.coverageApplicable: false`; preserve numeric report completion compatibility with zero but hide percentage claims in the UI. Include applicability in report summaries. New report captures store configuration, canonical routes, worksheets, answers, photo descriptors, and coverage; old captures stay unchanged.

## Phase 5 Build study authoring

1. Extend wizard state with allowed types, type-specific question selections/edits, current question-editor type, and review state. Keep vertices/name through every transition.
2. Use name -> boundary -> allowed types -> questions per enabled type -> review/create. Boundary Next no longer calls study creation. Derive stage labels rather than retaining the two-step multiplier.
3. Give selected types independent default question sets. Provide editable question cards, add-from-bank, custom choice/text, options, required flag, remove, up/down, and preview/review. A deselected type keeps its unsaved editor state if selected again but is omitted from submission.
4. Render authored content as escaped plain text. No rich-text editor or framework dependency is needed. Accept an entirely custom set as long as each enabled type has at least one question.
5. Extend the adapter's study POST, which currently drops all fields except name/boundary. Send the actual final questionnaire content and bounded source map. Guard duplicate final creation and preserve pending/error handling.

No new server-side study draft is required. Refreshing an uncreated study wizard may restart it, matching current behavior. Do not claim offline creation or durable unsaved study editing.

## Phase 6 Implement viewport layouts and map interactions

### Viewport contract

The supplied DuckDuckGo screenshot is 768 x 1,877 image pixels with about 768 x 1,570 of web content after browser/OS chrome. Raster pixels do not establish CSS pixels. Use 360 x 736 and 384 x 785 CSS pixels as ratio-matched fixtures, and measure the actual device content viewport if accessible. Preserve default text readability, zoomability, and large touch targets.

Use a scoped viewport shell sized with `100dvh` and a visual-viewport fallback. Remove inherited main padding/minimum heights on affected routes; use min-width/min-height zero for shrinking children. Restore ordinary layout/scrolling when leaving these screens.

- Sign-in: smaller title/gutters/spacing, Google and email actions retained, email/password/account creation/reset retained, long legacy explanation moved to separate help, bounded error area.
- Audit type: three compact allowed-type radio rows rather than tall illustrated cards.
- Questions: one question with compact progress/navigation; paginate long prompt/options without clipping or a scrolling panel.
- Review: bounded summary and paged answer inspection, compact location/edit link, three photo thumbnails in one row, and visible Back/Submit. Avoid a large embedded preview map and unbounded answer list.

In the new flow questions are step 4 and review step 5. The old shared worksheet-selection step disappears. Retained legacy worksheet pickers also need compact pagination rather than unchanged overflow. The primary fit assertion is keyboard closed/default text; also check keyboard focus and text zoom leave content reachable via bounded navigation.

### Full-viewport maps

Apply the map shell to study boundary drawing and every pin screen. The map rectangle fills the entire visible web viewport behind overlays; there is no reserved header band. Overlay or replace the global header, stage/title, instructions/readout/status, navigation, draw controls, geolocation, zoom, and attribution. Boundary controls may use two compact rows. Prevent overlay click/drag propagation and overscroll chaining without disabling map drag/pinch/wheel.

Remove page/card gutters, borders/radii, negative map margins, and fixed/clamped map heights on these routes. All controls must remain inside safe areas, without overlapping zoom/attribution. Observe viewport/container changes and invalidate Leaflet size; keep the existing map teardown/redraw guards and remove listeners at exit. Applying overflow hidden alone is not a passing layout.

### Pin behavior

Initialize at the saved active pin, otherwise current GPS when available, otherwise study center. Use the tile layer's finite maximum zoom, currently 19. Remove initial fit-to-study behavior. Location reacquisition explicitly recenters at maximum zoom; delayed initial GPS must not override manual interaction.

For street routes, provide A-confirmation and B-selection phases in the same no-scroll overlay. A snaps like intersection mode; B snaps to an edge. Display A/B pins, preview path, length, endpoint switching/reset, and Next. Save confirmed/partial endpoint state. Debounce preview requests and discard stale results by request identity; a late result cannot enable Next for different endpoints. An explicit Show route action may fit the path, while initial loading and resize must not auto-zoom out.

In edit mode, omit type selection and its review Edit link. Back from location cannot expose it. Existing routed audits reopen both pins. Legacy street locations remain until the contributor confirms replacement; cancellation restores the original. New-draft type changes clear incompatible route/location/answers; retained photos remain visible for reconsideration.

## Phase 7 Integrate adapter and all-studies directory

1. Keep the existing legacy/shared boundary. Shared mode uses saved study questionnaires; do not accidentally expose the legacy seeds as the deployed catalog.
2. Reuse one prompt view conversion: API text -> textarea; choice string options -> view `{ value, label }`; required -> optional inverse. Pinned historical audit detail still loads its original worksheet.
3. Replace dashboard exclusion/filtering with two independently paginated dashboard API groups. Set `privateRequest: true` explicitly for dashboard GETs: the current helper otherwise treats GET as public. Keep study links and creation actions. Include every Other study, including zero-audit studies, and correct empty states for new contributors.
4. Reconstruct point summary geometry from coordinates, and complete route summary geometry from ordered edge slices, orientation, and endpoint fractions. Never fall back to the parent/anchor LineString for either. Use audit ID for point/route observation identity and separate base-edge coverage rendering.
5. Extend `serialize` to cover answer/location/photo writes with the latest known draft version. Preserve newer in-memory edits when an older save completes. Do not blindly retry mutations after an unknown network outcome; refresh metadata/version first.
6. Add explicit route-preview and binary methods instead of sending unsupported paths through the legacy dispatch. Propagate read/preview cancellation or ignore stale results. Map photo paths against the API origin.
7. Preserve domain error text for immutable types, invalid/disconnected routes, and questionnaire mismatch. Keep stale-version messaging for actual version conflicts; the current blanket 409 replacement is insufficient.
8. Clear private previews/object URLs, queues, route state, and viewport listeners on identity change/sign-out. Keep the shared legacy offline outbox disabled.

## Phase 8 Implement optional photos

### Server

Add owner-private PUT/DELETE/GET `/api/walk-audits/drafts/:id/photos/:slot` and public GET `/api/walk-audits/audits/:id/photos/:slot`. Restrict writes to new-audit drafts; edit drafts preserve existing submitted attachments. Validate a canonical slot 1-3 before SQL and derive study/creator from the authorized parent, never from upload metadata.

For PUT, accept raw JPEG/PNG/WebP bytes, maximum 2 MiB, and validate actual signature against declared content type. The existing scoped JSON parser skips these non-JSON PUT bytes; mount a route-specific raw parser **after authentication** and keep JSON limits unchanged for other routes. Ensure future namespace media checks do not intercept this exact upload route. Convert parser size/type failures into scoped 413/415 responses rather than leaking a generic 500. Keep the image data outside JSON.

Require `If-Match: "<draft.version>"` on photo writes, using a strict positive-integer version. Missing precondition can return 428; a stale version returns the normal conflict. Lock study then private draft, mutate one slot, increment version, and return `{ draft }` with current ordered photo descriptors. Slot uniqueness enforces the race-safe total. Handle descriptor IDs as UUIDs rather than numeric domain IDs.

Private GET uses authenticated fetch, no-store, and owner checks. Public GET returns verified type, nosniff, and revalidation; absent/deleted images return 404. Draft/audit DTOs contain IDs, slots, sizes/types, and relative paths, never bytes. Do not select bytea for lists/ordinary reads.

Normalize PostgreSQL/PGlite binary results to a Buffer before sending an image response, and assert the returned bytes in tests. Do not let response JSON formatting turn an image into a serialized Buffer object.

When submitting a new audit, insert the audit, update photo rows to set audit parent and clear draft parent in one statement, then delete the draft, all in the existing transaction. A failure preserves original private rows. Parent deletion removes bytes. Reports capture counts/immutable descriptors, not binaries or guaranteed retained galleries after audit deletion.

### Browser

Provide optional camera/library selection with previews, count, progress, retry, and remove. Prefer browser normalization to JPEG with longest side at most 1,600 pixels; reject unsupported/undecodable files with a clear message, without a new HEIC dependency. The 2 MiB server limit remains authoritative. Never silently discard a failed/pending selected photo on Submit; require completion or explicit removal. Zero-photo audits submit normally.

Use a separate binary helper with Firebase/App Check and If-Match headers; the JSON helper must not stringify File/Blob. Queue writes with autosaves and merge newer local state correctly. Fetch private previews with headers and display revocable object URLs after reload. The existing CSP permits blob previews/API images and CORS permits PUT/DELETE/If-Match; verify preflight rather than broadening allowed hosts. Add the public images to audit detail/deep links.

## Phase 9 Verification commands and evidence

### Frontend

Run in the frontend directory:

```powershell
npm test
if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'Frontend whitespace check failed.' }
```

Add meaningful behavior tests in the new questionnaire test and [shared-api.test.js](../test/shared-api.test.js). Retain [mobile-contract.test.js](../test/mobile-contract.test.js) safeguards but do not rely on its source-string assertions as proof of viewport fit. Build output must include the JSON bank/helper and keep shared configuration/authentication behavior.

### Shared API

Run in the API directory. PowerShell must enumerate tests explicitly rather than passing an unexpanded wildcard:

```powershell
$walkAuditTests = @(Get-ChildItem -LiteralPath .\tests -Filter 'walkAudit*.test.ts' -File | Select-Object -ExpandProperty FullName)
& .\node_modules\.bin\tsx.cmd --test @walkAuditTests
if ($LASTEXITCODE -ne 0) { throw 'Walk audit tests failed.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'API build failed.' }
npm run docs:check
if ($LASTEXITCODE -ne 0) { throw 'API documentation check failed.' }
git diff --check
if ($LASTEXITCODE -ne 0) { throw 'API whitespace check failed.' }
```

Extend migration, generation, HTTP, service, and OpenAPI tests. Existing PGlite tests permit isolated SQL/HTTP checks without connecting to live Cloud SQL. The existing [walkAuditTestServer.ts](../../DallasUrbanists/cloud-api-server/tests/helpers/walkAuditTestServer.ts) is specifically for the opt-in real-PostgreSQL test; it is not a ready general browser/PGlite server.

Only run the optional PostgreSQL test when an already available dedicated loopback `walk_audit_test` database and both existing opt-in variables are explicitly configured. Its test creates/drops a unique schema and refuses other targets. Do not set those flags against the shared runtime DB, and do not spend the cap provisioning a new database. Without that target, report real-PostgreSQL persistence/concurrency as skipped rather than proven by PGlite.

### Focused verification matrix

| Test group | Cases to cover |
| --- | --- |
| Assignment/schema | Seven type combinations; zero/duplicate/unknown types; mismatched keys; empty or over-limit prompts; atomic generation/insertion failure; normal non-staff author; historical backfill and missing defaults. |
| Fixed forms | Same study/type has identical order/options across two contributors; template/bank revision does not affect it; wrong worksheet/answer keys/options/required answers rejected on every write path. |
| Type lock | All six ordered type-change pairs, direct PATCH/edit-draft PATCH/submit, staff, old mismatched edit draft, omitted/unchanged type compatibility, state preserved after rejection. |
| Graph | Shorter-distance path with more hops; reversed and parallel edges; equal-cost determinism after input reordering; disconnected components; same endpoint; crossing roads without a shared node; boundary clipping with an outside shared node. |
| Midblock/persistence | End at a node or inside an edge; orientation-aware slices; partial first-pin draft; save/reload/edit; legacy location retention/replacement; tampered edge list/length/geometry; stale preview. |
| Coverage/report | Multiple traversed edges; overlapping route intervals; partial final edge; complementary partial coverage; repeated observations; point count; disabled types; point-only percentages; report remains unchanged after audit edit. |
| Photos | Zero/one/two/three; slot 4; oversize and wrong signature/type; owner isolation; stale version; concurrent writes; submit rollback/transfer; no bytes in DTO/report; cascades; edit preservation. |
| Dashboard | Organizer-only, contributor-only, both, neither, zero-audit study, new viewer, multiple pages per group, correct counts/no duplicates/no per-study audit-list fetch. |
| Adapter/races | Point and whole-route summaries, binary request shape, latest version queue, preserved new text, domain conflict messages, account switching, draft mismatch without silent answer loss. |

### Browser harness and journeys

Use a local shared-API fixture or an explicitly prepared test environment. Running the retained standalone preview does not validate this feature, and starting the normal API development entrypoint can select production-connected configuration.

If no suitable browser fixture exists, add a loopback-only test helper using the PGlite/query adapter and generator fixtures already demonstrated in [walkAuditHttp.test.ts](../../DallasUrbanists/cloud-api-server/tests/walkAuditHttp.test.ts). Inject test authentication through the existing `createApp` options, serve the real built frontend, and provide a test-only Firebase module stub through the fixture server/browser routing. Keep all auth substitution under tests and out of shipped assets/runtime configuration. Route API requests through the real app without stripping their namespace, so parser/CORS behavior is exercised. Use a graph with at least two intersections, an alternate path, a midblock destination, and a disconnected component. A single-cross fixture is insufficient to verify all route behavior.

Label stubbed identity/GPS/Overpass conditions; they do not verify actual Google popup, App Check exchange, or provider availability. Do not add a production auth bypass or change the checked-in live API origin for browser testing.

Rehearse these journeys at both reference viewports and light/dark themes:

1. Sign-in fits with normal and error states; existing account creation/reset/profile/deep-link transitions still work.
2. A new contributor sees Other studies immediately. An organizer/contributor sees correct Your studies and can load additional pages of both groups.
3. Create an all-three-types study with edited bank and custom questions; navigate backward, toggle a type off/on, and confirm retained edits before final creation.
4. Submit an intersection, point, and two-pin street route. Save/resume a first pin, move B midblock, move A, and simulate stale previews/disconnected destinations.
5. Submit with zero and three photos, test failure/removal/retry, reload private draft previews, then view submitted photos anonymously.
6. Edit each submitted type; the type is read-only, location/answers remain editable, the street route reopens/replaces correctly, and photos are preserved.
7. Visit a legacy audit and a report; unchanged historical content still renders, and new edits do not alter old report captures.
8. Rapidly enter/leave maps, resize, change theme, expand/collapse browser chrome, and deny/delay GPS; no retired map redraw runs or zoom resets occur.

Measure root scrollHeight/clientHeight and scrollWidth/clientWidth with at most one CSS pixel rounding tolerance. Inspect visible control rectangles against the visual viewport, and inspect screenshots to catch clipped content hidden by scroll locking. Include longest allowed prompts/options via pagination, long review text, error states, and all three photo slots. On map routes, verify that the map covers the visible viewport, page/overlay scroll gestures do nothing, and map drag/pinch/wheel still change the map. Verify attribution/control separation, keyboard focus, text zoom reachability, and restoration of ordinary page scrolling after exit.

If the physical DuckDuckGo device is accessible, record its inner/visual viewport and pixel ratio and repeat the fit assertions there. If unavailable, report the device-specific check as unverified; passing ratio-matched desktop emulation is not proof of the exact physical device.

## Completion and escalation

At each checkpoint, continue with narrow corrections when the code still matches this runbook. Do not restart broad exploration of settled requirements. Replan only when new evidence changes a core assumption, such as an incompatible deployed contract, nonrecoverable saved topology, a conflicting schema migration, or an unavailable required integration.

At the 150-minute cap, stop feature expansion and provide a truthful handoff. Any remaining routing, authorization, data-preservation, type-lock, or viewport failure prevents declaring the full implementation complete. Record the failing input/test, exact symptom, smallest required next change, and what remains independently usable. Missing real-device or real-PostgreSQL access should be reported as an evidence gap, not silently converted into a passing test.

The final implementation report must include:

- Changed/new files in each repository, separate from pre-existing user work.
- Acceptance criteria A01-A14 marked complete, incomplete, or unverified, with relevant evidence.
- Exact test/build/doc commands and outcomes, including skipped checks and baseline unrelated failures.
- Migration filename/order and its backfill/compatibility behavior; no claim that it was applied to production.
- Elapsed execution time, remaining defects/limits, and release prerequisites.

For a later release, the order is additive database migration, compatible API, API smoke checks, then frontend hosting. Preserve the existing service/hosting configuration and exclude unrelated checkout changes. Rollback should keep the additive data and invariant checks; do not drop photo/route storage after new records exist, restore editable submitted types, or accept single-pin new street submissions merely to make an old client work.
