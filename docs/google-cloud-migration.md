# Google Cloud migration

The single release environment is https://dallasurbanists-walk-audit.web.app in Google Cloud project `dallasurbanists-idea-map-dev`. The frontend calls `https://api.dallasurbanists.org/api/walk-audits`. Historical Render records remain in place; new Firebase accounts do not automatically claim them.

## Launch scope

The launch uses one new Firebase Hosting site, `dallasurbanists-walk-audit`. It reuses the shared `urbanists-cloud-api-server` service, Firebase project `urbanists-mixer-slides-helper`, existing App Check registration/reCAPTCHA Enterprise key, and existing Cloud SQL instance `urbanists-mixer-slides-helper:us-south1:contacts-relationships-db`. No new Cloud Run service, database, bucket, identity provider, secret, or separate release environment is needed.

The two existing worksheet versions are intersection observation and street observation. The six `walk_audit_*` tables already existed when inspected. The worksheet seed was rerun idempotently; no legacy records were imported or deleted.

The user explicitly chose to omit backups, backup/recovery rehearsals, and a separate staging environment for this launch. Existing unrelated services and any pre-existing protection settings were left in place.

## Implementation

- [shared-api.js](../public/shared-api.js) maps the implemented shared API to the existing screens, pages through lists, projects public author information, loads pinned worksheet versions, and serializes versioned draft writes.
- [firebase-auth.js](../public/firebase-auth.js) delegates identity and token refresh to Firebase. Private API calls include Firebase ID and App Check tokens; public reads omit credentials.
- [app.js](../public/app.js) retains study and audit deep links, adds sign-in/account creation/profile registration, resumes private server drafts, and clears private in-memory state on sign-out or identity changes.
- [shared.json](../config/shared.json) explicitly selects the shared backend for the hosted build. The standalone development server keeps its legacy default.
- [build-static.js](../scripts/build-static.js) copies frontend/vendor assets into the ignored build directory and emits the public runtime configuration. Its service-worker replacement unregisters legacy caching. No database connection is present in the hosted frontend.
- [firebase.json](../firebase.json) defines the dedicated site, SPA rewrites, exact CSP sources, and runtime configuration cache controls.
- [deploy-hosting.py](../scripts/deploy-hosting.py) publishes only this named site with the current gcloud operator login. It does not overwrite the existing Idea Map hosting site or require Firebase CLI refresh credentials.

The shared API release was assembled from the exact source archive of the previously deployed API image, with the maintainer's walk-audit modules and scoped integration changes. This preserved unrelated deployed features without publishing other pending checkout changes. The API checkout's street-generation request was changed from POST to the documented Overpass GET interface with an identifying user agent after the former transport failed in the live journey. The conventional query form returned real Dallas road data in approximately 38 seconds, exceeding the original 25-second attempt cutoff. The release allows 55 seconds per attempt and sets `WALK_AUDIT_GENERATION_TIMEOUT_MS=120000`. Keep these changes in the API maintainer's next commit/release.

The frontend now requests OpenStreetMap basemap tiles directly. No CARTO server key or tile-proxy service is required. Both themes use the same basemap for this release.

## API mapping

| Existing UI interaction | Shared implementation |
| --- | --- |
| Sign-in/out and session | Firebase SDK; `GET/POST /contributors/me` |
| Personal dashboard | Paginated studies and audit authorship composed by the adapter |
| Study creation | `POST /studies` with neighborhood and polygon only |
| Study/map/history | Study detail, paginated study audits, and progress |
| Thumbnail | Absolute API-origin `/studies/:id/thumbnail` URL |
| Worksheet | Paginated selection plus concrete version/ID; detail read for submitted audits |
| Draft save/resume | Private draft endpoints with serialized `expectedVersion` PATCH |
| Submission/edit | Draft submit with `expectedVersion`; server decides create versus edit |
| Reports | Paginated reports and organizer report capture |

No dual writing, browser-side legacy import, cookie transfer, or email-based ownership claiming is performed. Shared-backend requests never use the old signed cookie session.

## Deployment and access configuration

The public hostname and its `firebaseapp.com` alias were added to the existing Firebase authorized sign-in domains and reCAPTCHA allowed domains. The exact two frontend origins were added to shared API CORS. CSP includes the SDK's actual `content-firebaseappcheck.googleapis.com` exchange endpoint.

To release frontend changes, run `npm ci`, `npm run build`, and `python scripts/deploy-hosting.py` after `gcloud auth login`. The deployment script fixes the Google Cloud project and site explicitly. Firebase CLI uses a separate login and is not needed by this path.

For shared API changes, use the API maintainer's existing release process and preserve existing service configuration. Do not run a new standalone database, migrate application data automatically, or redeploy unrelated local API edits. Migrations `009_walk_audits.sql` and `010_seed_walk_audit_worksheets.sql` belong to the API repository.

## Launch evidence

The required live journey passed on November 7, 2026, within the two-hour launch window. The frontend release is `sites/dallasurbanists-walk-audit/releases/1794076465863000`; the shared API release is `urbanists-cloud-api-server-00114-gft`, serving 100% of traffic.

- Frontend: 11 tests passed, including four shared-adapter tests.
- Shared API: TypeScript build passed; 13 focused fixture/PGlite tests passed. The six generation tests were rerun successfully after the query/timeout fix. These tests do not establish live PostgreSQL concurrency behavior.
- Live API: seeded worksheet reads and exact-origin CORS passed.
- Live browser: account creation, App Check-protected profile creation, and the personal dashboard passed.
- Live study creation: generated and persisted 207 street features and 36 intersections from real OpenStreetMap data.
- Live submission: created a private draft, saved each step/answer through the API, and submitted an intersection audit. The saved observation remained visible after a full browser reload.
- Live identity: signed out, signed back in with the new account, and saw the owned study and its submission on the dashboard.
- Anonymous deep link: the submitted audit and its pinned worksheet answers loaded after sign-out without edit controls.
- Live report: captured a report containing the submitted observation. The public thumbnail returned a valid 384 × 384 PNG.

The live smoke test left a clearly labeled synthetic study, audit, and report, all with ID `1`. Their content explicitly identifies them as migration verification, not a field observation. No production study was deleted. The smoke-test account was signed out after verification.

## Google sign-in follow-up (November 7, 2026)

The Google popup initially failed with `auth/internal-error`: the browser's CSP blocked Firebase Auth's `https://apis.google.com/js/api.js` loader. Added only `https://apis.google.com` to `script-src` and deployed Hosting release `sites/dallasurbanists-walk-audit/releases/1794079107382000`. After reloading the attached browser, Google authentication succeeded and reached first-time contributor profile setup. The user's profile form was left for them to complete; no profile was created on their behalf. App Check token acquisition and the protected profile lookup also passed after reload (404: profile not registered yet); the earlier App Check 403 did not recur.

## Deferred work

The subsequent [user journey rehearsals](./user-journey-rehearsals.md) cover all ten deployed frontend journeys and record seven fixes, live evidence and scope limits. The latest frontend release is `sites/dallasurbanists-walk-audit/releases/1794081341446000`. Study creation exposed unreliable default Overpass endpoints; shared API revision `urbanists-cloud-api-server-00115-sxg` now tries the alternate provider already used by the shared service first, with `overpass-api.de` as fallback. This was a configuration-only API change. Frontend fixes cover map lifecycle, worksheet answer retention/autosave, custom descriptions, report double-clicks and asynchronous route error handling. Both synthetic test accounts were signed out after verification; synthetic study 2 and its observations/reports remain for inspection.

These tasks are outside the expedited launch. Estimates are planning ranges, not completed work.

| Priority | Follow-up | Estimate and acceptance |
| --- | --- | --- |
| High | Historical Render import and ownership verification | 1–3 days. Use an operator-owned import with verified identity and explicit old/new ID mappings; preserve feature IDs, worksheet versions, timestamps and relationships. Original report snapshots cannot be reconstructed exactly from the old schema. Obtain separate import authorization. |
| High | Private offline drafts and conflict reconciliation | 1–3 days. Design identity-scoped storage, account-switch cleanup, reconciliation and safe retry semantics. Current shared launch keeps unsaved answers only in page memory and persists saves through the API. A 409 surfaces an error rather than overwriting server data. |
| High | Full database/auth/browser regression coverage | 1–2 days. Real PostgreSQL concurrency, provider failures, multi-account privacy, pagination at scale, mobile devices, Firebase Google popup flow and authorization boundaries. The launch smoke covers the required journey only. |
| Medium | Study/report/audit management UI | 1–2 days. Add report narrative/title/membership editing, study editing and explicit destructive controls. Study deletion must clearly state that everyone's associated observations, drafts, reports and thumbnail are permanently deleted. No deletion controls were added for launch. |
| Medium | Routine deployment and monitoring | 0.5–1 day. Automate tested frontend/API releases, release provenance and basic alerts using existing infrastructure. Review provider reliability and database sizing for observed traffic. |
| Medium | Custom domain and legacy-link transition | 2–4 hours plus DNS time. Choose the public domain, configure Firebase/Auth/App Check/CORS/CSP, and decide how old numeric deep links and device drafts should transition. Do not blanket-redirect old IDs to unrelated new records. |
| Medium | Backup and recovery policy | Separate future effort. Backups and rehearsals were explicitly excluded from this launch; no recovery guarantee is established by it. |
| Low | Remove obsolete standalone code | 2–4 hours after legacy retention/import decisions. Retire email-cookie auth, standalone SQL persistence, demo fallback, duplicate generation and Render deployment configuration without breaking retained historical access. |
| Low | Basemap styling and PWA polish | 2–4 hours. Restore separate dark/light basemaps if desired and design safe caching; private requests must remain outside public caches. |

Do not decommission Render until the historical-data retention decision is complete. The new website is independently usable at its Google-hosted URL.
