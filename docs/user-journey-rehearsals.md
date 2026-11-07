# User journey rehearsals

Target: https://dallasurbanists-walk-audit.web.app, shared API release environment. Rehearsal date: November 7, 2026.

Outcome: all ten rehearsals passed within the scope and limitations below. Seven discovered defects were corrected, deployed and revalidated. Final verification completed at approximately 19:57 UTC.

Use explicitly labeled synthetic accounts, studies, observations and reports. Exercise the deployed UI through the attached browser, observe real requests, fix failures immediately, redeploy affected changes, and repeat the failing journey before continuing. Do not modify unrelated users' content. Record actual evidence and distinguish unsupported features from failures.

## Rehearsal plan

| ID | Journey | Acceptance |
| --- | --- | --- |
| J01 | Anonymous visitor | Open shared study and audit deep links; map, worksheet answers, progress and reports render; editing/report generation stay hidden; contribute returns through sign-in; missing pages recover. |
| J02 | Identity and onboarding | Google popup reaches profile/dashboard; profile Back works; email account creation, required name, returning login, invalid credentials, reset-password validation and logout work; requested deep link survives authentication. |
| J03 | Organizer and study creation | Empty dashboard, start/cancel study, name validation, boundary add/undo/clear/back, map controls, location denial and actual creation work; generation pending state prevents duplicates; study and thumbnail survive reload. |
| J04 | Intersection observation | Type, location, description, worksheet, required/optional answers, previous/next and review edits work; autosave resumes after cancel/reload; submission persists and updates map/history/progress. |
| J05 | Street observation | Select actual segment, complete its distinct worksheet, submit, reload and inspect public detail; street progress reflects unique features. |
| J06 | Editing and conflicts | Owner edit preserves pinned worksheet and answers; save updates existing audit; multiple observations of one feature do not double-count progress; competing draft saves surface a conflict without overwriting private work. |
| J07 | Reports | Organizer generates a report; it renders after reload/public viewing; subsequent audit changes leave its historical snapshot unchanged; other contributors cannot generate reports. |
| J08 | Account isolation | A second synthetic contributor sees their own dashboard/drafts, can contribute to a shared study, cannot edit another author's audit or read their private draft; sign-out/account switch clears private client state. |
| J09 | Navigation and presentation | Study link copying, map audit popup, history keyboard activation, back/forward/deep links, light/dark persistence, phone layout and map controls work. |
| J10 | Interrupted work and recovery | Offline save shows actionable error and retains current answers; reconnect recovers without duplicate submission; stale/missing resources recover safely; no private service-worker cache or durable shared outbox. |

## Scope limits

The deployed frontend has report capture/display, but no study/report/audit deletion, study editing, report editing or draft-discard controls. Those deferred API capabilities are not existing browser journeys and are not declared validated by this exercise. Password reset email delivery and interactive Google account selection require the relevant mailbox/account holder; only observed portions can be reported as passed. Location and network fault conditions may be deliberately simulated and will be labeled.

## Execution evidence

Synthetic organizer: `walk-audit-rehearsal-a-20261107-1924@example.com`; contributor: `walk-audit-rehearsal-b-20261107-1924@example.com`. Synthetic study: [study 2](https://dallasurbanists-walk-audit.web.app/studies/2), named REHEARSAL 2026-11-07 — synthetic fieldwork. Temporary test credentials were removed from both tabs' session storage after sign-out. The synthetic records remain available for inspection.

| Finding | Correction and revalidation |
| --- | --- |
| Creation returned 503: existing Overpass primary returned upstream error and the old fallback timed out. | Verified the alternate provider already used by the shared API returned 200 with real OSM data. Set only `WALK_AUDIT_OVERPASS_URLS` to `https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter`; existing timeout/limits retained. API revision `urbanists-cloud-api-server-00115-sxg`. Repeated browser creation passed; study 2 has 5,226 segments and 1,344 intersections. Double-clicks sent one creation request per attempt. No study was created on the failed attempt. |
| Rapid study/dashboard/wizard navigation ran a delayed resize on a destroyed Leaflet map. | Guard resize callbacks against the active map list; repeated rapid transition passed with no page errors. |
| Worksheet notes disappeared when pressing Back before Next. | Capture changes immediately and debounce shared API saves; preserve newer local changes when an earlier save completes. Back/Next and full reload both retained notes. Simulated offline save retained the entered text, displayed a connection error and recovered through a real save on reconnect. |
| Revisiting location replaced the custom description with a generic feature label. | Preserve descriptions for an unchanged feature; use mapped street names where available. Repeated Back/Next, review editing, submission and reload preserved the custom description. |
| Double-clicking report generation created two snapshots. | Disable report generation during the request; repeated double-click increased persisted report count from two to three, not four. Existing synthetic duplicates remain clearly inside the rehearsal study. |
| Directly opening another author's edit URL left the screen loading after the API correctly returned 404. | Await asynchronous route renderers inside their error boundary. Denied edit, missing study and missing audit all now display a recovery page. A deliberately interrupted study GET showed Try again; removing the fault and retrying loaded the real study. |
| A background-tab canvas redraw ran after its renderer was removed. | Removing vector paths before the map reduced the race but was insufficient when a hidden tab became visible. Guard each renderer's queued redraw callback against a missing map/context as well. On the final release, repeated visible phone-width map/popup/detail navigation passed; explicitly invoking seven retired renderer callbacks after teardown also produced no errors. The guard uses Leaflet 1.9's internal canvas callback/context hooks, so retain this regression check when upgrading Leaflet. |

Additional passing evidence: both intersection (audit 2) and street (audit 3) submission; required type/description/worksheet/answer validation; optional answer skipping; owner edit updated audit 2 instead of creating another audit; pinned worksheet 1 and prior answers restored; report 3's full captured payload remained unchanged after editing audit 2. A controlled same-draft competing write returned 409 and retained the current selection; reload recovered without blind overwrite. Synthetic contributor B could not read organizer draft `3b66e195-9707-4a7c-9f05-167c24b66ea8` (404) and it was absent from B's private list. B's dashboard was empty before contribution; another author's edit control and organizer report control were absent.

## Journey results

| ID | Result | Observed evidence |
| --- | --- | --- |
| J01 | Passed | Anonymous launch study/audit and rehearsal study/audits loaded; public answers/reports/progress rendered; no owner controls; contribute preserved its login return URL; missing routes recovered. |
| J02 | Passed within scope | Google returned to the requested contribution route using the existing Google session. Both synthetic email accounts registered through the UI. Empty display name rejected; profile Back returned to login; first-time onboarding preserved the contribution URL. Incorrect password returned `auth/invalid-credential`; correct password reopened the owned/contributed dashboard. Reset without an email rejected; reset request for the synthetic account returned 200 and displayed confirmation. Mailbox delivery was not tested. |
| J03 | Passed | Empty organizer dashboard; start, cancel, required neighborhood name, boundary add/undo/clear/back and actual drawn/panned polygon; real network generation passed after the provider fix. Double-click created one study. Study 2 and its decoded 384-pixel thumbnail survived reload. Permission-denied location callback was simulated and displayed its error. |
| J04 | Passed | Intersection audit 2 completed every wizard step, required validation, review editing, Back/Next, autosave/reload and offline/reconnect. Final answers, custom description and owner controls survived reload. |
| J05 | Passed | Street audit 3 used worksheet 2's walking-comfort question, skipped optional notes and persisted the submitted detail after reload. Street coverage became 1 of 5,226. |
| J06 | Passed | Editing audit 2 retained worksheet 1 and existing answers, updated that same audit and left report 3's captured payload unchanged. Competing same-draft PATCH caused 409 without a blind retry. B's audit 4 targeted the same actual intersection as audit 2 using a simulated device location; 3 observations still covered only 1 intersection and 1 street. |
| J07 | Passed | Report generation persisted across reload and anonymous reads. The double-click guard produced one report; historical capture stayed unchanged after later audit edits. Contributor and anonymous views hid organizer report controls. |
| J08 | Passed | A second account registered in the phone layout, initially saw no studies, contributed audit 4 and then saw the study on its dashboard. Private draft access/list isolation and author edit restrictions passed. Switching the main tab from organizer to contributor showed B's profile/draft rather than A's; A's draft returned 404. Both tabs signed out at the end. |
| J09 | Passed within scope | Desktop map popups for both street and intersection opened the correct latest audit; popup link and browser Back/Forward worked. History keyboard activation, link-copy confirmation and both theme persistence checks passed. At 390 × 844, study and audit content had no horizontal overflow, loaded tiles, and the phone history card opened its audit. The phone-width popup check was initially inconclusive because the tab was hidden; once visible, two repeated map/popup/detail cycles opened audit 3 correctly with no page errors. |
| J10 | Passed within scope | Actual offline PATCH failed with an actionable message and retained notes; reconnect saved and submitted once. A simulated interrupted GET recovered with Try again. Missing/denied routes displayed recovery pages. Submitting a draft already consumed in the other tab returned 404, kept review content, and created no duplicate. No private local draft/outbox keys, service-worker registrations or caches remained. |

The delayed-save test held one real PATCH while newer text was entered: the older response did not replace the newer visible text. Background timer throttling delayed the second automatic save; pressing Next persisted it. A foreground save and reload then confirmed the newest answer on the server and in audit 4. This does not establish a browser-independent background-save deadline.

Clipboard readback was unavailable through this browser host; successful copy confirmation and the constructed study link were checked. Hidden-tab reCAPTCHA/storage-access diagnostics were nonblocking for the observed private journeys: real profile, draft and submission requests obtained valid App Check tokens. Attestation enforcement was retained.

## Release and regression evidence

- Shared API configuration revision: `urbanists-cloud-api-server-00115-sxg`, 100% traffic. Only the walk-audit provider environment setting changed; no backend source or unrelated settings were redeployed in this rehearsal.
- Latest frontend release: `sites/dallasurbanists-walk-audit/releases/1794081341446000`.
- `npm run build` passed. Final `npm test` passed all 11 tests after the last code change. The first sandboxed run could not connect to its two local smoke-test servers (`EACCES`); the authorized loopback-enabled rerun passed.
- Source changes are in [app.js](../public/app.js); prior Google popup CSP correction is in [firebase.json](../firebase.json). Deployment context is in [google-cloud-migration.md](./google-cloud-migration.md).
- Alternate provider is listed among [OpenStreetMap's global Overpass instances](https://wiki.openstreetmap.org/wiki/Overpass_API#Instances_with_global_data_coverage); the same provider was already configured for Streetmix on this shared service.
