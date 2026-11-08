# Study questionnaires implementation plan

Use the [implementation runbook](./study-questionnaires-implementation-runbook.md) for ordered execution, contracts, commands, and acceptance evidence. The [handoff prompt](./study-questionnaires-handoff-prompt.md) starts the next implementation agent.

Move question selection into study creation. An author enables any combination of **intersection**, **street segment**, and **point**, then defines one questionnaire for each enabled type. Every new audit of the same type in that study receives the same saved questions. Contributors can also optionally attach **up to three photos per audit** during audit creation. The [researched question catalog](./aarp-question-catalog.md) supplies 56 original starter definitions based on AARP's public worksheets, with source references and proposed defaults.

The same release simplifies the specified mobile forms to fit the reference viewport, makes study drawing and audit pinning maps fill the viewport with overlay controls, opens pin maps at maximum supported zoom, and shows every public study on the dashboard with the contributor's own studies first.

Street-segment audits will select the shortest street-network path between two pins in both creation and location editing. The first pin snaps to an intersection; the second can end along a street. Once an audit has been submitted, its audit type is immutable.

**Target maximum execution time: 150 minutes, or 2.5 hours, for one implementer.** The deliverable is a tested implementation in the frontend and shared API repositories, additive migrations, built assets, and a release handoff. This is an implementation plan; production migration and deployment are subsequent operator actions. The estimate assumes dependencies are installed, both checkouts are writable, and the existing test fixtures work. Use the prepared catalog and existing choice/text form formats to stay within the target.

## Current implementation

The deployed Firebase frontend uses the shared API at `/api/walk-audits`. Changing the standalone Node server alone would not change the public application. The [migration notes](./google-cloud-migration.md) describe the active deployment and retained legacy backend.

| Area | Existing behavior and relevant files |
| --- | --- |
| Study setup | Two screens for name and boundary; immediately generates the study. See [app.js](../public/app.js), `renderNewStudy`, `studyWizardFrame`, and `createStudyFromWizard`. |
| Audit setup | Six steps, including a volunteer worksheet picker; questions and review depend on that selection. See [app.js](../public/app.js), `renderAuditWizardScreen`, `renderWorksheetStep`, and `selectedWorksheet`. |
| Shared adapter | Explicitly sends only name and boundary on study creation. It translates worksheet prompts, serializes versioned draft writes, derives feature IDs from GeoJSON, and fetches pinned worksheets for audit details. See [shared-api.js](../public/shared-api.js). |
| Landing dashboard | Lists studies rather than individual audits. The adapter currently hides studies unless the viewer organized or contributed to them. See [shared-api.js](../public/shared-api.js), the `dashboard` branch, and [app.js](../public/app.js), `renderDashboard`. |
| Mobile layout | Large headings/card padding, tall choice cards, and fixed minimum map heights consume more than the usable viewport. The global header and main padding also sit outside map height. See [styles.css](../public/styles.css). |
| Shared API schema | Worksheets already have immutable version IDs. Drafts and audits pin those IDs, but studies have no allowed types or assigned worksheets. Types are limited to intersection and street-segment. See [009_walk_audits.sql](../../DallasUrbanists/cloud-api-server/migrations/009_walk_audits.sql). |
| Shared API validation | Only `choice` and `text` prompts; choices use string options, answers use strings, unknown mutation fields are rejected. Global worksheet writes require staff. See [walkAudit.ts](../../DallasUrbanists/cloud-api-server/src/models/walkAudit.ts) and [walkAuditValidation.ts](../../DallasUrbanists/cloud-api-server/src/utils/walkAuditValidation.ts). |
| Active starter forms | The shared API seeds two short observation worksheets. The larger AARP-themed definitions in [worksheets.js](../src/worksheets.js) belong to the legacy backend and are not the deployed catalog. See [010_seed_walk_audit_worksheets.sql](../../DallasUrbanists/cloud-api-server/migrations/010_seed_walk_audit_worksheets.sql). |
| Geospatial and reporting | Shared workflows require a known network feature and exact feature geometry. Coverage counts distinct intersections and segments; reports capture worksheet definitions and audit answers. See [walkAuditWorkflows.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditWorkflows.ts). |
| Routing topology | The shared generator stores clipped OSM way edges with stable IDs encoding their source node IDs, rather than guaranteeing one feature per whole block. It does not yet expose a route graph or route selections. See [walkAuditGeospatial.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditGeospatial.ts). |
| Audit editing | The existing type chooser and direct/draft API patches permit changing a submitted audit's type. Locking only the visible chooser would leave API and resumed-edit-draft bypasses. See [app.js](../public/app.js) and [walkAuditWorkflows.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditWorkflows.ts). |

Cross-repository links above assume the existing sibling checkout at `DallasUrbanists/cloud-api-server`. Its current working changes include the Overpass generation fix in [walkAuditGeospatial.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditGeospatial.ts), migration handoff documents, and an unrelated Postiz directory. Preserve that work and keep any later release scoped to the walk-audit changes.

## Product decisions for this release

1. Require at least one allowed type and at least one question for each allowed type. A study may enable any of the seven nonempty type combinations.
2. Define an intersection as an existing mapped meeting of streets. A street-segment audit covers one selected shortest path through the saved street network, potentially traversing multiple stored edges. A point remains one coordinate along a mapped edge; it can be midblock or at a junction. Route selection does not create a fourth audit type.
3. Start each enabled type with the catalog's small default selection. Offer individual bank questions, editable wording and answer options, optional/required controls, add-custom-question, remove, and move-up/move-down controls. Authors may replace every suggested question.
4. Support existing single-choice and text answers, including custom options. Ratings use single-choice questions. Keep multiple choice, numeric input types, branching, and richer form building outside this 2.5-hour release. Optional audit photos are attachments, independent of questionnaire prompts.
5. Freeze type selection and questionnaire definitions when study creation succeeds. Question editing happens during creation. Later catalog updates and staff template revisions cannot change a study's frozen questionnaire. Post-creation questionnaire revision would require a separate product decision about comparability.
6. Existing historical audits retain their original questions. Future observations in an existing study use the migration's fixed per-type selection described below. Historical audit edits keep their original type and worksheet; they cannot change those fields to bypass the study configuration.
7. Accept zero, one, two, or three photos for any audit type. Photos are never required and do not affect completion or question validation. Keep draft photos private to their author; submitted photos have the same public visibility as the audit.
8. Fit sign-in, audit type selection, questions, and audit review within the reference mobile viewport without vertical page scrolling. Study boundary drawing and all three audit pinning screens must be map-first full-viewport pages, with every other control overlaid and no page or panel scrolling in either direction.
9. Show all public studies after sign-in. Group studies the viewer organizes or has submitted an audit to under **Your studies**, followed by **Other studies**, as clarified by the user. Do not replace this dashboard with an individual-audit feed.
10. Default every audit pinning map to its highest supported zoom at the active pin or current location. Keep panning and manual zoom available.
11. For street-segment creation and location editing, confirm a first pin snapped to a study intersection, then place a second pin snapped to the street network. Select the shortest path by physical distance between them. The second pin may be midblock; only the first pin is constrained to an intersection.
12. Make the type of every submitted audit immutable, including during edit-draft saves, direct API edits, and edit submission. Ordinary new, unsubmitted drafts may still change type, clearing incompatible question/location/route state as described below.

## Study creation and participation

Expand study creation to five logical stages: **name -> boundary -> allowed audit types -> questions for each selected type -> review and create**. The question stage can show one type at a time and display its position within the selected types. Derive progress labels from the actual stages rather than retaining the current hard-coded two-step total.

Boundary confirmation should advance the wizard rather than create the study immediately. Hold name, vertices, allowed types, selected questions, edits, and ordering in the existing wizard state. Back/forward navigation must preserve them. Temporarily deselecting a type hides its editor but retains its unsaved choices if it is selected again. The final request includes only enabled types. No server-side study draft is needed for this release; refreshing an unfinished creation wizard restarts it, as it does today.

Use a simple list of question cards and an explicit **Add question** action opening the appropriate type's bank or a blank custom question. Keep the selected question wording editable without changing the source bank. Provide ordinary keyboard-accessible buttons and the existing large mobile targets; drag-and-drop is unnecessary. The review lists allowed types, question counts, and final ordered prompts, and explains that creation fixes them for all participants.

Creating an audit becomes **type -> location -> description -> questions -> review**. Show only the study's enabled types and select automatically when there is only one. Resolve the questionnaire from the saved study configuration. Remove the worksheet picker and its review edit link. Update back navigation, resume positions, question progress, labels, and review actions together. Changing type in a new, unsubmitted draft clears incompatible location, route, and answer state and loads the destination type's assigned questionnaire.

Editing an existing audit skips the type chooser. Display the saved type as read-only in review and remove its Edit action. Back from location cannot reach a type chooser; step labels reflect the available edit stages rather than leaving a selectable or empty type step. Location, description, and answers remain editable under the audit's existing type and pinned questions. Street-segment location edits use the same two-pin route selector as creation.

Add an **Optional photos (0 of 3)** panel to audit review, with camera/photo-library selection, thumbnails, upload status, and a remove button per photo. This keeps the five-stage audit flow. Retain uploaded attachments across back/forward navigation and draft resume. When the audit location or type changes, retain the photos and show them in review so the contributor can remove any that no longer apply.

## Mobile viewport layouts

The reference DuckDuckGo screenshot is 768 by 1,877 image pixels. Browser and operating-system chrome leave approximately 768 by 1,570 pixels for the web page, including the application header. A screenshot does not establish the device's CSS pixel width or pixel ratio. Use **360 by 736 CSS pixels** as a conservative fixture with the same usable aspect ratio, plus **384 by 785** as a second ratio-matched fixture. During device verification, record `innerWidth`, `innerHeight`, `visualViewport.width/height`, and pixel ratio; the final no-scroll acceptance must also pass at that actual content viewport. Do not size the page as though the full screenshot height were available to the website.

Build a shared viewport shell in [styles.css](../public/styles.css) and route-level layout state in [app.js](../public/app.js). Size it from `100dvh`, with a visual-viewport measurement fallback where browser chrome or the keyboard reduces visible space. Account for safe areas once. Give grid/flex children `min-height: 0` and `min-width: 0`, and remove inherited main padding and minimum heights where the viewport shell takes over. Keep readable text, the existing large touch targets, and browser zoom. Hiding overflowing content or shrinking it below usable sizes does not satisfy the requirement.

### Compact forms

| Screen | Design change |
| --- | --- |
| Sign-in | Use a compact header/title, one short introductory sentence, tight field spacing, and full-width Google/email actions. Retain email, password, account creation, and password reset. Move the long legacy-account explanation into a separate help view. Reserve space for a short error/status message so a failed sign-in does not push the primary action below the viewport. |
| What are you auditing | Replace large illustrated cards with three compact radio rows: Intersection, Street segment, and Point, filtered by the study's allowed types. Keep one short description per row, a compact progress header, and a bottom action row. |
| Questions | Show one question with compact progress, answer controls, and fixed-in-layout navigation. Paginate long option lists or unusually long authored content within the same step; preserve answers between pages. Do not hide complete prompt/option text or introduce an inner scrolling panel to achieve the fit. |
| Review | Replace the unbounded answer list and large preview map with a compact summary and an in-place, paginated answer review. Show photos as at most three thumbnails in one responsive row, with selection/removal controls and bounded status text. Keep Submit and Back visible; route location edits back to the pin screen. |

The existing deployed step 4 is worksheet selection, which this plan removes; existing step 5 is questions, which becomes step 4; review becomes step 5. Apply the fit requirement to both questions and final review in the new flow. If the retained legacy mode still renders a worksheet picker, give that picker the same compact, paginated treatment rather than leaving its overflow unchanged.

All required actions must fit at the reference viewports with default text size and the keyboard closed, including the three-photo review state and visible validation/upload errors. Test keyboard focus and browser text zoom separately and keep all content reachable through the bounded step/detail navigation. Prefer in-place pagination over either clipping or adding a scrollbar when content is long. Scope any scroll lock to the specified screens; the dashboard and study/audit history remain ordinary scrolling pages.

### Full viewport maps

Apply the full-viewport map shell to **New Study > Draw the study area** and **New Walk Audit > Pin the intersection / street segment / point**. The map must occupy the entire visible web viewport behind every control, including the space currently consumed by the application header. Replace or overlay the global header on these routes; do not reserve an opaque header band or a section beneath the map.

- Position the map edge-to-edge in a viewport-sized container. Remove card borders/radii, outer gutters, negative margins, fixed/clamped map minimum heights, and page-level action trays on these routes.
- Overlay a compact top bar for back/title/step and a bottom control tray for selection/description/status and the primary actions. Boundary actions retain Add corner, Undo, Clear, Back, and Next, using two compact rows if needed. Pin screens retain location readout, Back, and Next. Overlay geolocation, zoom, and attribution controls with safe-area offsets and enough separation to avoid collisions.
- Disable document and panel scrolling on these routes, including overscroll chaining, while leaving Leaflet drag/pinch/wheel gestures functional inside the map. Prevent taps/drags on overlays from propagating to the map. Keep every control reachable without any vertical or horizontal scroll.
- Use viewport/resize observation to update container dimensions and call `invalidateSize` after layout changes, address-bar expansion/collapse, and orientation changes. Preserve existing Leaflet teardown safeguards. Clean up listeners and restore normal page/header layout when leaving these routes.

## Pin map starting position and zoom

In [app.js](../public/app.js), update `initializeAuditLocationMap`, its GPS success handler, and the explicit current-location action for **all three audit types**. Resolve the starting point in this order: a saved/current audit pin when resuming, current device location for a new audit when available, then the existing study-center fallback if location is denied or unavailable. When location is still being acquired, initialize the fallback at the same close zoom rather than showing the whole study first.

After adding the tile layer, use the map/layer's finite maximum zoom rather than hard-coded zoom 16, 17, or 18. The current [tile-layer configuration](../public/app.js) supports zoom **19**, so the current default will be 19. Do not introduce unsupported tile zoom levels. Remove the pin screen's initial `fitBounds` call, and do not let a later resize or boundary layer reset the zoom. Center on the selected/snapped point where one exists. Street-segment selection starts close to its first/current endpoint and stores the complete selected route, independently of the visible map extent.

The explicit current-location action recenters and restores maximum zoom. A delayed GPS result must not undo a manual pan, selected pin, or user zoom; track interaction so only an untouched initial map follows that result automatically. Manual zoom-out remains available. Boundary drawing and study overview maps keep their task-appropriate starting extents; the maximum-zoom default applies specifically to audit pin screens.

## Two pin street route selection

### Interaction and route meaning

Use two explicit phases inside the existing full-viewport **Pin the street segment** screen, for both new audits and edits. First, show **Set start intersection**; drag/place the first pin using the existing intersection snapping behavior and confirm it. Then show **Set end point**; place a second pin on the nearest saved street edge, including a midblock position. Do not require the second pin to be an intersection. Highlight the discovered path and show its length and start/end descriptions in the overlay. Answer the street-segment questionnaire once for the selected route, rather than once per underlying edge.

Label the two pins A and B. Allow selecting/moving either endpoint, resetting the selection, and explicitly showing the whole route. Recompute after an endpoint changes; disable Next while a preview is pending or invalid. Ignore stale preview responses from earlier endpoint positions. Keep first-pin and partial selection state in the private draft so resuming does not force a restart. If the study has no intersections, the endpoints coincide, or no path connects the selected points within the study network, explain the problem and allow repositioning; never substitute a straight line or an unrelated street.

Preserve the no-scroll overlay design and the maximum starting zoom. Confirming the first pin must not automatically zoom out or reset it. The contributor can pan/zoom to place the second pin; an explicit **Show route** action may fit the route to the map because that is a user-requested view change. A late GPS result must not move a confirmed endpoint or silently set the second pin.

### Saved network and shortest path

Build an undirected walking graph from the study's saved clipped street edges. Weight edges by their physical length in meters and use Dijkstra's algorithm for the shortest-distance path, with a stable edge-ID tie-break for equal-length alternatives. Route only over the existing eligible study network; this release does not introduce an external routing provider, routing credentials, or motor-vehicle one-way rules.

Preserve OSM connectivity. Lines that merely cross on the map, including grade-separated roads, must not become connected. For new networks, add explicit endpoint-node keys to feature properties while preserving existing feature IDs. For existing networks, derive keys from the source node IDs encoded in the stable edge IDs plus their clipped endpoint positions, normalized consistently for floating-point rounding. Include position in the key so distinct boundary cuts around an outside node do not create an artificial connection outside the study. Do not join roads solely because coordinates are close, regenerate old studies, or alter historical feature IDs.

Project the second pin onto its selected edge and create a temporary graph endpoint at that position, splitting that edge's weight for the search. A destination already at a real node reuses that node. Respect ordered edge direction when assembling the resulting continuous LineString, and retain partial-edge fractions when the destination is midblock. Reject zero-length routes and disconnected components explicitly.

Implement a focused routing helper in the shared API, with fixtures using the existing saved-feature format. Add authenticated `POST /api/walk-audits/studies/:id/route-preview`, accepting `startIntersectionId` and an end edge ID/coordinate and returning canonical endpoints, ordered edge slices, route LineString, and total length. Validate that all inputs belong to the same study and the end coordinate matches its edge inside the study. Debounce endpoint preview requests and protect against out-of-order responses in the browser. The server helper is the authority for preview and persistence, avoiding different browser/server pathfinding results.

### Route storage and compatibility

Add nullable `route_selection` JSONB to both audits and drafts in the new migration. Expose it as `routeSelection`. Endpoint intent uses `startIntersectionId` and `end: { featureId, locationGps }`; the canonical response also includes `edges: [{ featureId, fromFraction, toFraction }]` in traversal order and `lengthMeters`. Fractions follow each source edge's stored coordinate order and may decrease when traversing backward. The saved audit GeoJSON is the canonical complete route LineString. Keep the existing non-null `featureId` as the first traversed edge's compatibility anchor; it is no longer the full route identity or a sufficient source for coverage. Intersection and point records have no route selection.

Partial drafts may hold just the confirmed first endpoint. A completed street-route selection is required before a new route can be submitted. Recompute and validate canonical routes on location-changing saves, direct creation/edit, and final submission using the same routing helper; do not trust a submitted edge list, claimed shortest path, length, or GeoJSON. Return the canonical selection and current draft version. Existing answer autosaves must preserve route state without discarding newer endpoint changes.

Extend adapter mapping, draft resume, review, audit detail, audit summaries, and report snapshots to retain both endpoints and the complete route. Summary responses may omit full geometry only if they include enough ordered route metadata to reconstruct it from the loaded study network. Never replace the displayed route with its first edge. Identify route observations by audit ID so paths sharing a first edge do not hide one another.

Historical one-feature submitted street audits remain valid under a nullable legacy selection. Preserve their existing location when changing other fields. When editing such an audit's location, show the original selection and offer the two-pin replacement flow; require explicit confirmation before replacing it, and allow cancellation back to the original. The server permits the legacy selection only when editing that persisted audit without changing its geometry/endpoints. A legacy unsubmitted street draft must confirm a two-pin route before its first submission, retaining its previous answers for review. New routed audits reopen with both saved pins and their path. Do not invent an intersection start for a historical single-edge observation or silently rewrite its answers.

For progress, derive coverage from every traversed edge slice, rather than counting only the anchor `featureId`. Union overlapping intervals across route observations, count a base edge complete only when its full length is covered within a documented coordinate/length tolerance, and show partial final edges as partial rather than coloring the whole edge complete. Historical single-feature audits contribute their original full edge. Repeated and overlapping routes do not inflate completion, passing through a junction does not count as an intersection audit, and point audits still do not complete street edges. Report captures include the full route selection and resulting coverage snapshot.

## Immutable audit type during editing

Apply the type lock to **every submitted audit**, including historical records and staff edits. A new unsubmitted draft can still change type, but an edit draft derives its type and worksheet from its target audit and cannot change either. Enforce this in direct audit PATCH, edit-draft PATCH, and edit-draft submission in [walkAuditWorkflows.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditWorkflows.ts), under the existing locks and `expectedVersion` checks.

Accept an omitted type or an unchanged type value for compatibility with clients that resend the full form. A different type returns a specific conflict such as `AUDIT_TYPE_IMMUTABLE` before modifying type, location, route, answers, or photos. Recheck the persisted target audit during submission rather than trusting edit-draft fields. Update OpenAPI and the shared adapter so a missing type control does not send a null type or reset dependent fields. Creating a separate audit is the way to record a different audit type.

If an old edit draft already contains a type different from its target audit, reject its submission and offer to start a fresh edit draft from the saved audit. Preserve the mismatched draft for reference rather than silently relabeling incompatible answers. The read-only type label and absence of type-edit controls must remain consistent through review, back navigation, reload, and resume.

## All studies dashboard

Keep the landing page as a study directory. Show **Your studies** first, defined as studies the signed-in contributor created or has at least one submitted audit in; show **Other studies** below. A study appears in exactly one group. A person with no contributions must still see other people's studies, including studies with zero audits. Use stable newest-first ordering within each group, with study ID as a tie-breaker, and give each group its own empty state and pagination/load-more control. All public studies must be reachable, beyond the first API page.

Replace the adapter's current client-side exclusion filter in [shared-api.js](../public/shared-api.js) and render both groups in [app.js](../public/app.js). Avoid expanding the current one-audit-list-request-per-study approach to every public study. Add a small authenticated `GET /api/walk-audits/dashboard?group=mine|other&limit=...&offset=...` endpoint in [walkAuditRoutes.ts](../../DallasUrbanists/cloud-api-server/src/routes/walkAuditRoutes.ts), backed by grouped audit counts and a creator/participation `EXISTS` check in the existing study service. Derive the contributor from verified identity, not a caller-supplied user ID. Return compact study metadata, audit counts, and pagination, without fetching polygons or private drafts.

Load the two groups independently, retain the existing public study-detail links and creation action, and document the endpoint and grouping in OpenAPI. The existing public studies endpoint remains available. The grouping does not change public visibility or let an organizer modify someone else's audit. Normal vertical scrolling remains appropriate for this directory.

## Question catalog and persistence

During implementation, encode the [catalog](./aarp-question-catalog.md) as the new `public/question-bank.json` asset. Keep selection, cloning, validation, and ordering helpers in a small new `public/questionnaires.js` module with behavior tests in `test/questionnaires.test.js`. The existing [static build](../scripts/build-static.js) will copy both public assets automatically. The bank drives authoring only; persisted study definitions drive participation, audit details, and reports. The API accepts arbitrary valid authored questions and therefore needs no live AARP requests or duplicate runtime question bank.

Reuse `walk_audit_worksheets` for immutable final definitions and existing `worksheet_id` audit references. Add:

- `is_template boolean NOT NULL DEFAULT true` on worksheets. Existing global templates remain true; study-generated copies are false. Global worksheet lists return templates only; direct pinned-ID reads remain public.
- A `walk_audit_study_questionnaires` table with `study_id` referencing studies with cascade deletion, `audit_type` constrained to the three types, `worksheet_id` referencing worksheets with restricted deletion, `catalog_version`, and bounded JSON source metadata keyed by study question ID. Its primary key is `(study_id, audit_type)`. Its rows define the allowed types, avoiding a second database array that could disagree with the assignments.
- Updated type checks on audits, drafts, and worksheet recommendations to accept `point`. Preserve the existing numeric worksheet ID and version contracts.
- Nullable `route_selection` JSONB on audits/drafts and explicit routing endpoint keys on newly generated street features. Keep original feature IDs and historical single-edge audit geometry intact.

Each study created through the new authoring flow gets one new worksheet row per enabled type, with a unique study/type slug, version 1, final ordered prompts, `recommend_for` containing that type, and the AARP collection link as source context. Entirely custom sets can use the application's own documentation URL instead. Source metadata records which selected prompts were adapted from which catalog entries; custom questions have no AARP source claim.

Validate the complete study payload before reserving an Overpass request. After successful network generation, insert the study, immutable worksheets, and assignment rows in one existing transaction. A failure must leave no partially configured study or orphan new worksheets. Keep existing study-first lock ordering for later draft and audit writes.

Study-owned definitions remain fixed in this release: no questionnaire update route is needed. Global staff CRUD remains staff-only; the normal study creation workflow is the authorized path for ordinary authors to create their own question sets. Staff template mutation routes must reject study-owned copies rather than promote a revised copy into the global list. Assignment references prevent deletion of pinned definitions. If a study is deleted, its assignments cascade away while the immutable worksheet rows may remain unlisted; garbage collection of unreferenced copies is outside this change.

## API contract and enforcement

Extend `POST /api/walk-audits/studies` with `allowedAuditTypes` and `questionnaires`. The latter is keyed by enabled type and contains the selected final prompts and source metadata. Validate that the array is nonempty, unique, and contains only supported types, and that questionnaire keys match it exactly. Limit study questionnaires to 30 questions per type, within the current validator's 100-question maximum. Reuse existing label, option, text-length, answer-size, and request-body bounds, and return normal validation errors before network generation.

Example of the new request fields, alongside the existing `neighborhood` and `area`:

```json
{
  "allowedAuditTypes": ["intersection", "point"],
  "questionnaires": {
    "intersection": {
      "prompts": [
        {
          "id": "q-1",
          "type": "choice",
          "label": "Can someone using wheels enter and leave the crossing by a usable ramp?",
          "required": true,
          "options": ["Yes", "No", "Not applicable", "Not observed / unsure"]
        }
      ],
      "sourceMetadata": {
        "catalogVersion": "aarp-topics-v1",
        "questions": { "q-1": { "sourceQuestionId": "i-curb-ramp" } }
      }
    },
    "point": {
      "prompts": [
        {
          "id": "q-2",
          "type": "text",
          "label": "Describe the entrance at this spot.",
          "required": false,
          "maxLength": 2000
        }
      ],
      "sourceMetadata": { "questions": {} }
    }
  }
}
```

Return `allowedAuditTypes` and a `questionnaires` mapping in study detail, including each fixed worksheet ID, title, prompts, and provenance. Compact study lists need only the allowed types if the dashboard displays them. Document these additions in [walkAudits.ts](../../DallasUrbanists/cloud-api-server/src/docs/walkAudits.ts).

Every write path must enforce the same policy in [walkAuditService.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditService.ts) and [walkAuditWorkflows.ts](../../DallasUrbanists/cloud-api-server/src/services/walkAuditWorkflows.ts):

- New-draft type changes derive the assigned worksheet on the server and clear previous answers/location/route when the type changes. Edit drafts keep the target audit's type and worksheet; a type change is rejected before clearing any state. A supplied worksheet ID may be accepted only if it equals the relevant assignment or pinned historical definition; it cannot choose a different form.
- Partial saves validate answer keys and values against the assigned worksheet. Do not accept arbitrary answers before a type/questionnaire has been resolved.
- Direct audit creation, direct audit edits, and draft submission independently validate allowed type, exact worksheet assignment, matching geometry, and required answers. Enforcing only the browser or draft endpoint would leave a bypass.
- Existing historical audit edits are the narrow exception: preserve their stored type and pinned worksheet, and validate edited answers against that original definition. New submissions never receive this exception.
- Every new street audit requires a complete two-pin route, including direct POSTs and submissions from old clients. Direct PATCH, edit-draft PATCH, and edit submission reject changed audit types with `AUDIT_TYPE_IMMUTABLE`. A persisted legacy street audit can keep its original single-edge location, but replacing its location requires a validated route and cannot downgrade a routed audit back to a single edge.
- Keep `expectedVersion` conflict detection, draft privacy, contributor authorization, report snapshots, and serialized client autosaves intact. Missing setup and draft/questionnaire mismatch errors must have specific codes and useful text.
- Update the audit-type union, runtime validation, query-filter parsing in [walkAuditController.ts](../../DallasUrbanists/cloud-api-server/src/controllers/walkAuditController.ts), SQL checks, and OpenAPI enums consistently.

Treat authored labels, options, and descriptions as plain text and use the existing escaping functions everywhere they are displayed. Validate provenance as bounded structured metadata, without fetching author-supplied URLs. New report captures must include the fixed assignments and their source metadata alongside the worksheet definitions and answers already captured.

Keep the old study-create request compatible during rollout: if both new fields are omitted, create a study with the two existing types and explicitly pinned default templates. If only one is supplied, reject it. The new UI always supplies both. This prevents cached older clients from creating unconfigured studies. Older audit clients attempting a different worksheet must receive a clear error; they must never silently weaken the server's assignment rule.

Add `routeSelection` to the appropriate allowed draft/audit fields and separate the small endpoint-intent request schema from the canonical route response schema. The adapter sends endpoint intent, not the derived edge list/LineString, when selecting a route; server generation keeps large derived paths outside mutation JSON bounds. Document the route-preview response, partial versus completed draft selection, immutable edit type, and compatibility errors in OpenAPI.

Preserve specific domain conflict messages in the adapter. `AUDIT_TYPE_IMMUTABLE` and questionnaire/route setup errors must not be replaced with the current generic 409 message suggesting that another tab changed the item. Keep the existing stale-version guidance for genuine version conflicts.

## Optional audit photos

For the 2.5-hour implementation, store bounded image bytes in the existing Cloud SQL database, following the study thumbnail's existing storage approach. The API's [storageService.ts](../../DallasUrbanists/cloud-api-server/src/services/storageService.ts) currently signs suggestion uploads but does not validate uploaded bytes or provide private draft access. Introducing a separate signed-upload lifecycle is unnecessary for this small initial allowance; storage can move behind the same photo API later if volume warrants it.

**Upload behavior:** support JPEG, PNG, and WebP, with a maximum stored size of **2 MiB per photo** and **three photos total per audit**. Prefer browser resizing to a maximum 1,600-pixel longest edge and JPEG re-encoding before upload, which also removes original metadata from those normalized files. Reject unsupported or undecodable selections with a clear message; do not add a HEIC conversion dependency. The server must independently enforce the byte limit and validate the actual image signature against the declared type, rather than trusting a filename. Do not send image data as base64 inside questionnaire answers or other JSON requests.

Add `walk_audit_photos` in the same new additive migration, with UUID ID, study/contributor identity, `draft_id` or `audit_id`, `slot` from 1 to 3, content type, byte count, image bytes, and creation timestamp. Require exactly one draft/audit parent, consistent study and contributor ownership, cascade deletion with the parent, and unique `(draft_id, slot)` and `(audit_id, slot)` constraints. The three constrained slots enforce the limit even for concurrent uploads or callers bypassing the UI. Existing audits have an empty photo list and require no data conversion.

Add these namespaced routes, with explicit OpenAPI request/response definitions:

| Route | Behavior |
| --- | --- |
| `PUT /api/walk-audits/drafts/:id/photos/:slot` | Authenticated owner-only upload or replacement of one draft slot. Parse bounded binary image bytes after authentication, with a route-specific raw-body limit independent of the existing JSON limits. |
| `DELETE /api/walk-audits/drafts/:id/photos/:slot` | Authenticated owner-only removal of an attachment before submission. |
| `GET /api/walk-audits/drafts/:id/photos/:slot` | Authenticated owner-only preview; private/no-store response. |
| `GET /api/walk-audits/audits/:id/photos/:slot` | Public submitted image, with the verified image content type, `nosniff`, and revalidation. Return 404 for deleted or missing photos. |

Photo writes require the draft's current version through an `If-Match` header, lock the study and then the draft, and increment the draft version. Return the updated draft and photo descriptors, and serialize these requests with answer autosaves in [shared-api.js](../public/shared-api.js). Use a dedicated binary request helper with the existing Firebase/App Check headers; the current JSON request helper must not stringify a File or Blob. Draft/audit DTOs return ordered photo metadata and relative photo paths, never image bytes. Private thumbnails after reload must be fetched with authentication and displayed through temporary object URLs, which the browser revokes when no longer needed.

Verify upload preflight from the frontend origin and private preview rendering. The current [CORS middleware](../../DallasUrbanists/cloud-api-server/src/middleware/cors.ts) already permits `PUT`, `DELETE`, and `If-Match`, and [firebase.json](../firebase.json) already permits blob previews and images from the API origin; preserve those settings without adding another image host.

Submission moves all draft photo rows to the new audit in the **same transaction** that creates the audit and consumes the draft. A failed submission preserves the draft and photos. Removing a draft, audit, or study cascades to the corresponding image bytes, avoiding orphan external uploads. For this release, editing an already submitted audit preserves its existing photos; adding/replacing photos during later audit edits is outside the requested creation flow, so photo write routes reject edit drafts and the edit UI only displays existing attachments.

Show pending/failed uploads and allow retry or removal without losing question answers. If selected photos are still uploading or have failed, prevent final submission until they finish or the contributor explicitly removes them; never silently drop a selected photo. An audit with no photos submits normally. After submission, show the uploaded photos on audit detail, including public deep links. Report captures record the photo count and immutable descriptors only, keeping image bytes outside the existing 16 MiB report payload. Embedded report galleries and image retention after audit deletion are outside this release.

## Point geometry and progress

For point audits, keep `featureId` as the ID of the containing mapped street edge. Store a GeoJSON **Point** and matching `locationGps` at the chosen position along that edge. Intersection audits continue storing the mapped Point; routed street audits store the canonical complete route LineString, their endpoint selection, and the first traversed edge as the compatibility anchor. A route's `locationGps` is its confirmed start intersection, with its end coordinate stored in `routeSelection`.

Reuse the browser's nearest-point projection when dragging or locating the pin. Add a server-side point-to-segment projection/measurement helper, validate the parent segment belongs to this study, require the submitted coordinate inside the boundary and within one meter of that line, and save canonical point geometry. A supplied GeoJSON Point must agree with the location coordinate. A point placed halfway along a street must remain there after save, reload, and edit; it must not jump to the closest intersection or become the full street geometry.

If the study has no mapped features suitable for an enabled type, explain that no location is available and keep the location confirmation disabled. Do not invent a street or intersection when the generated network is empty.

Update [shared-api.js](../public/shared-api.js) in both directions. Point summaries need synthesized Point geometry from their saved coordinates because the audit-list endpoint omits full GeoJSON. Do not let the existing fallback render the parent street line. Routed street summaries must reconstruct the full path from ordered edge slices and endpoint metadata, rather than show only their first edge. Draft payload mapping must preserve the point's parent or route's anchor `featureId` instead of blindly replacing it from a different geometry ID.

Use separate map grouping keys: point and routed street submissions by audit ID, intersections and legacy single-edge observations by type plus feature ID. Distinct routes sharing a first edge and distinct point observations on one street must remain visible. Render completed base-edge coverage separately from observation identity; a point must never color the whole street as completed.

Compute network coverage only over enabled finite types, with routed street coverage based on the union of edge intervals described above. A point-only study has no finite target count. Add a point submission count and `overall.coverageApplicable`; show **N point observations** and **Coverage not applicable** when appropriate. Read audit identity and route selections for progress: the current distinct `(type, feature_id)` query both collapses points and loses the rest of each route. Keep the stored numeric report completion compatible by retaining zero when no denominator exists, but include the applicability flag in captured progress and report summaries so the new UI never presents that zero as 0% complete. Historical report captures remain unchanged. Mixed studies show intersection/street coverage alongside the separate point count.

## Existing studies and drafts

Use a new additive migration after the current latest API migration, without editing or rerunning historical migrations to change their meaning. Add the table, template flag, and expanded checks, then backfill two assignments for every existing study:

1. For each existing type, pin the worksheet used by the most recently created submitted audit of that type, breaking timestamp ties with the largest audit ID.
2. If that type has no submitted audit, pin the current explicit default slug (`intersection-observation` or `street-observation`) at the highest existing version. Resolve by slug/version rather than assuming database IDs 1 and 2.
3. If a required default is missing, fail with an actionable error before changing data. The operator can seed the existing defaults and retry. Migration tests should verify transactional rollback and preserve unrelated rows.

This is a proposed compatibility policy: future observations become uniform while older mixed questionnaires remain historical records. No existing study automatically gains point audits. The first release keeps migrated configurations fixed; changing an existing study's allowed types or questions later is a separately scoped revision feature.

Leave existing submitted audits, answers, worksheet versions, timestamps, and report captures untouched. Detect an old unfinished draft whose type or worksheet differs from the assignment and return a specific conflict before saving or submitting. Show its prior answers for reference and offer to start a separate draft using the study questions. Keep the original draft; do not silently overwrite answers or copy values just because two prompts share an ID. Historical edit drafts continue against their original audit definition; an edit draft whose type was already changed must restart from the original audit as described above. Nullable route selections preserve legacy submitted single-edge geometry; old unsubmitted street drafts need an explicit two-pin selection before submission.

## Repository changes

| Repository | Planned changes |
| --- | --- |
| Neighborhood Walk Audit | New static question-bank JSON and a small pure questionnaire-state helper; study editor, compact forms/review, full-viewport map shells, maximum-zoom pinning, two-pin route selection, immutable edit-type controls, grouped study dashboard, and optional photos in [app.js](../public/app.js); study/draft/point/route mapping, preview sequencing, grouped directory reads, and binary upload serialization in [shared-api.js](../public/shared-api.js); viewport/overlay/compact form/photo styles in [styles.css](../public/styles.css), with header/layout adjustments in [index.html](../public/index.html) as needed; focused tests alongside [shared-api.test.js](../test/shared-api.test.js) and browser layout checks; update [README.md](../README.md), [data-model.md](./data-model.md), and [migration notes](./google-cloud-migration.md). |
| Shared cloud API | One additive migration including photo storage and route selection; models, validators, study creation/DTOs, template listing, assigned-question enforcement, immutable audit types, point geometry, routing graph/helper and preview, route-aware interval coverage, grouped dashboard query/route, photo routes/ownership/limits/transactional attachment, report metadata, query filters, OpenAPI, and focused tests in the existing walk-audit modules. Update [walk-audits.md](../../DallasUrbanists/cloud-api-server/docs/walk-audits.md). |
| Retained standalone backend | Preserve historical operation in [server.js](../src/server.js), [repository.js](../src/repository.js), and [worksheets.js](../src/worksheets.js). Gate the new editor by shared-backend mode and keep the old local flow until a separate legacy-parity task. Local server preview does not establish that the deployed feature works. |

Do not add a second hosted API, a new database, a new frontend framework, or dependencies for a general-purpose form builder. Keep the existing Overpass provider/timeout fixes.

## Execution schedule

The expanded sequence includes questionnaires, photos, compact forms, full-viewport maps, maximum pin zoom, the grouped all-studies dashboard, two-pin shortest-path selection, and immutable audit types, and totals **150 minutes**, including a final buffer. This remains an aggressive target for one implementer. The extra 30 minutes adds a dedicated 25-minute routing allocation, four more minutes for final verification, and one more minute of buffer. Type immutability is included in the API and edit-UI work. Reuse existing forms, map helpers, authentication, database, and test fixtures; do not reduce required behavior or skip acceptance checks to claim completion within the cap.

| Elapsed time | Budget | Work and completion checkpoint |
| --- | --- | --- |
| 0-5 min | 5 min | Check both working trees/tests; encode catalog/defaults; settle questionnaire/photo/dashboard/routing fixtures and reference viewport sizes. |
| 5-28 min | 23 min | Add migration/backfill, photo slots/route selection, atomic study questionnaires, DTOs/template filtering, fixed-question and immutable-type enforcement, and grouped dashboard query/route. |
| 28-38 min | 10 min | Add point geometry, type/filter/schema changes, routing endpoint keys, enabled-type progress flags, and point-count fixtures. |
| 38-63 min | 25 min | Implement saved-network graph and Dijkstra routing, midblock endpoint projection, route preview/persistence validation, route/legacy coverage, and focused routing fixtures. |
| 63-81 min | 18 min | Build study type selection, editable per-type question cards, bank/custom questions, ordering/required controls, and creation review. |
| 81-105 min | 24 min | Implement compact forms, full-viewport map overlays and two-pin interactions, read-only edit type, maximum-zoom initialization, and grouped dashboard. |
| 105-115 min | 10 min | Finish shared-adapter route/point mapping and previews, bounded review/navigation, resume, summary geometry, domain errors, and legacy-mode gating. |
| 115-133 min | 18 min | Implement photo routes, authorization/limits, transactional attachment, binary requests, compact review thumbnails, and submitted display. |
| 133-145 min | 12 min | Run focused checks/builds and browser journeys: routes and immutable types, measured viewport overflow, map gestures/zoom, dashboard groups, and zero/three photos. |
| 145-150 min | 5 min | Reserve for integration fixes, documentation, diff review, and release handoff; stop feature expansion. |

At minute 63, routing and its server validation must be working; at minute 81, the study editor must be functional; at minute 105, the viewport layouts, two-pin UI, edit-type lock, and grouped dashboard must be in place. At minute 133, freeze scope and verify, including photos. A blocker in schema enforcement, routing correctness, immutable edit types, photo ownership/limits, data preservation, map/viewport behavior, directory visibility, or tests means an explicit incomplete handoff at the cap; it does not justify publishing a partially working feature or claiming the full scope passed. The cap is a planning target, not a guarantee that unknown failures fit it.

## Verification and acceptance

Add behavior tests where errors would lose data or permit inconsistent study answers. Existing geospatial extraction, authentication, and historical flows should keep passing.

| Scenario | Required result |
| --- | --- |
| All type combinations | Accept all seven nonempty combinations; reject zero types, unknown/duplicate types, missing questionnaires, extra type keys, or an enabled type with no questions. |
| Normal author | A registered non-staff contributor creates a study containing edited bank questions and entirely custom questions. Global worksheet administration remains staff-only. |
| Frozen definitions | Two contributors receive identical question order/options for the same study/type. Revising the global catalog or a staff template does not alter those questions. |
| Enforcement | Reject disabled types and wrong worksheet IDs through draft save, draft submit, direct POST, and direct PATCH. Reject unknown answer IDs, invalid options, oversized input, and missing required responses. |
| Atomicity and migration | Generation or insert failure leaves no partial study/worksheets/assignments. Backfill picks the documented version, preserves historical audits/reports/unrelated rows, and handles missing defaults transactionally. |
| Editor state | Back/forward, type deselection/reselection, reorder, changed options, and custom IDs preserve unsaved state correctly. A duplicate source question cannot accidentally reuse a study question ID. |
| Autosave and editing | Reload/resume and queued saves retain current answers and versions. Type changes clear incompatible answers; old mismatched drafts remain recoverable; historical edits keep their pinned form. |
| Point geometry | A midblock point, two points on one segment, a point at a junction, and an out-of-bound/off-segment coordinate behave correctly. Reload/detail/edit retain Point geometry. |
| Shortest route and topology | Select a start intersection and end intersection/midblock point; prefer the shorter distance over fewer hops, handle reversed/parallel edges and deterministic ties, and reject same-point or disconnected selections. Crossing lines without shared nodes and clipped paths outside the boundary must not create shortcuts. |
| Route persistence and editing | Save/resume a first pin, then both pins and the complete route. Moving either pin updates the path; a delayed preview cannot overwrite a newer selection. Reopen and edit a submitted street audit without changing its type. Retain historical single-edge locations unless explicitly replaced. |
| Route coverage and reports | Count all covered edge intervals, not just the first edge. Overlapping routes do not inflate completion, a partially covered final edge is not complete, and two routes with the same first edge both display. Captured routes/coverage remain unchanged after a later audit edit. |
| Immutable audit type | Test all six type-change directions through direct PATCH, edit-draft PATCH, and edit submission, including staff and a pre-upgrade mismatched edit draft. Reject before changing dependent state; omitted/unchanged types still permit ordinary edits. The UI never exposes a type-edit action, including after reload/back navigation. New unsubmitted drafts can still switch types and clear incompatible route/answers. |
| Progress and reports | Disabled finite types are excluded; repeated segment/intersection audits count once; point observations never complete a segment; point-only reports show no misleading percentage. |
| Mobile participation | Complete one audit of each type without a worksheet picker. Review and edit the custom answer; reopen the study and audit from a public deep link. |
| Compact viewport fit | At 360 by 736 and 384 by 785 CSS pixels, and the device's measured content viewport, sign-in/type/questions/review need no vertical scrolling. Include validation messages, longest allowed authored content/options through pagination, and three photos; all actions remain visible and all content reachable. |
| Full map viewport | Boundary drawing and all three pin maps cover the entire visible viewport behind overlays. Root and overlays have no vertical or horizontal overflow; controls/attribution do not collide; map drag/pinch/wheel still work. Leaving the screen restores ordinary page scrolling. |
| Pin zoom and location | Each type opens at the tile layer's supported maximum zoom, currently 19, at the saved/current/fallback point. GPS success and the current-location button preserve the close default; delayed GPS, resize, and initial fit-to-area do not override a user's chosen view. |
| All studies and grouping | Include organizer-only, contributor-only, both, unrelated, and zero-audit studies, plus a newly registered viewer and more than one page per group. Every study is reachable in exactly one correct group, with Your studies above Other studies, without per-study audit-list requests. |
| Photo count and validation | Submit with zero, one, two, or three images; reject slot 4, oversized/unsupported/mislabeled uploads, and a concurrent attempt to exceed three attachments. Images are separate from questionnaire answers. |
| Photo access and lifecycle | Another contributor cannot upload, remove, or read a draft's photos. Submission makes the saved images publicly viewable; failed submission preserves them; draft/audit/study deletion removes the corresponding bytes. |
| Photo recovery and editing | Back/forward and reload retain uploaded photos and answers. Failed or interrupted upload supports explicit retry/removal. Pending uploads cannot disappear silently on submit; editing an existing audit preserves its photos. |
| Photo transaction and reports | Photo writes and autosaves respect draft versions. Submitting transfers photos before consuming the draft, without losing attachments or exceeding three; report JSON contains photo metadata but no image bytes. |

Run `npm test` and `npm run build` in the frontend. In the API, run the focused `walkAudit*.test.ts` suite, `npm run build`, and `npm run docs:check`. Add focused route-graph tests and extend [walkAuditMigration.test.ts](../../DallasUrbanists/cloud-api-server/tests/walkAuditMigration.test.ts), [walkAuditHttp.test.ts](../../DallasUrbanists/cloud-api-server/tests/walkAuditHttp.test.ts), [walkAuditGeneration.test.ts](../../DallasUrbanists/cloud-api-server/tests/walkAuditGeneration.test.ts), and [walkAuditService.test.ts](../../DallasUrbanists/cloud-api-server/tests/walkAuditService.test.ts). Update every fixture that applies migrations. Use PGlite and existing test identities; do not add tests that only match implementation strings.

Use an already configured isolated PostgreSQL target for the existing concurrency test if available; otherwise report it as unverified rather than spending the window provisioning infrastructure. Browser rehearsal must exercise the shared API contract through test fixtures or an explicitly prepared test environment. The retained standalone preview cannot validate the new feature by itself.

For the viewport acceptance, measure document `scrollHeight`/`clientHeight` and `scrollWidth`/`clientWidth` with at most one CSS pixel of rounding tolerance, check that actionable element rectangles stay inside the visual viewport, and inspect screenshots to catch clipping that a scroll lock would conceal. On map routes, also measure the map rectangle against the visual viewport and attempt page/overlay scroll gestures while confirming that map pan and zoom still change the map. Exercise browser chrome expansion/collapse, orientation changes, keyboard focus, long error text, theme changes, and route cleanup. A CSS `overflow: hidden` rule alone is not evidence of a fitting, usable screen. Record any unavailable real-device check as unverified.

## Release handoff

Record migration order, test/build results, any unverified checks, and the exact scoped diffs. Follow the existing [deployment notes](./google-cloud-migration.md) for a later production release: apply the additive database migration, release the compatible API, verify assignments and public worksheet reads, then publish the frontend. Preserve unrelated API checkout work and existing hosting/service configuration.

For rollback, prefer fixing forward or reverting the frontend while keeping the additive schema, fixed API validation, and audit-type immutability. Older clients may show actionable worksheet or route-selection errors but must not restore volunteer-selected questions, single-pin new street submissions, or editable submitted types. Do not drop the new tables/route columns or remove type constraints from a database that already contains point or routed audits. Production deployment, legacy backend parity, editable published questionnaire versions, offline conflict reconciliation, and advanced answer types need separate execution time.
