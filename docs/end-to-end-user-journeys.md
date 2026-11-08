# End-to-end user journeys

This checklist exercises the shared-API frontend in an attached browser using
the loopback-only browser fixture. The fixture uses an in-memory database,
synthetic users, fixed road topology, and stubbed sign-in. It does not test
real Firebase authentication, App Check, live Overpass, or physical GPS.

| ID | Journey | Expected result | Result |
| --- | --- | --- | --- |
| E01 | Anonymous access and navigation | Sign-in and public study pages render; anonymous users cannot edit or create reports. | Passed |
| E02 | Sign-in and account isolation | A contributor can sign in and out; changing identities does not expose another user's private drafts. | Passed with fixture identity |
| E03 | Study directory | Your studies and Other studies show the correct groups and paginate independently. | Passed after fix |
| E04 | Study creation and questionnaire authoring | Create a study with intersection, point, and street types; edit questions, navigate back, and preserve changes. | Passed after fix |
| E05 | Intersection observation and draft recovery | Choose a crossing, complete required answers, resume work, submit, and reload the public audit. | Passed |
| E06 | Point observation | Choose a midblock point, submit an observation, and reload its point location. | Passed with simulated GPS |
| E07 | Street route | Choose a start and end, reject a disconnected destination, resume and submit a valid route. | Passed with simulated GPS |
| E08 | Photo attachments | Add, remove, and retry photos; submitted photos are visible on the public audit. | Passed |
| E09 | Audit editing | The author can edit an observation without changing its type or losing answers, location, or photos. | Passed for all three types |
| E10 | Reports and legacy content | A legacy audit and report remain readable; an organizer can generate a report that survives reload. | Passed |
| E11 | Map and mobile navigation | Maps, controls, themes, and ordinary page navigation remain usable at phone-sized viewports. | Passed in browser emulation |
| E12 | Error recovery | Required fields and connection errors provide actionable feedback without silently losing entered work. | Passed with simulated failures |

## Execution evidence

Executed November 8, 2026 in the attached browser against the real built
frontend and the sibling API's [loopback fixture](../../DallasUrbanists/cloud-api-server/tests/helpers/walkAuditBrowserFixture.ts).
All records and images were synthetic and stored in memory. No production data
was changed.

- E01–E02: A public study and legacy audit loaded without owner controls. The
  contribution link returned through fixture sign-in. After switching users,
  the new viewer's dashboard showed no owned studies and a direct read of the
  other user's private draft returned 404. The other user's audit had no Edit
  button, and its edit URL displayed a recovery page.
- E03: The contributor's groups loaded independently from 12 each to 16 and
  13, with no duplicate study links. The new viewer loaded 29 other studies in
  three pages. Empty and exhausted groups no longer show Load more.
- E04: Created a three-type study after editing a starter prompt and option,
  adding a custom question, returning to type selection, and toggling a type
  off and on. The saved study retained the edits. A second study was created
  after exercising duplicate-corner validation.
- E05–E07: Submitted an intersection with a required answer and optional note;
  both survived draft reload and submission. Submitted a midblock Point and a
  two-edge LineString route. The route's first pin survived reload; a
  disconnected endpoint was rejected and a connected endpoint enabled Next.
- E08–E09: Uploaded three images, simulated an upload failure and retried it,
  removed and re-added an image, and confirmed all three loaded anonymously.
  Edited intersection, point, and street audits without a type selector;
  answers, point coordinates, route endpoints, and existing photos persisted.
  Rechecked an actual file chooser and photo submission after the style fix.
- E10: A legacy single-edge audit and its historical answer rendered. Its
  report still contained the historical snapshot after later edits. An
  organizer generated a separate report and saw it again after reload.
- E11: At 360 × 736 and 384 × 785 CSS pixels, light and dark themes rendered
  without horizontal overflow in the checked screens. The location map filled
  the viewport; dragging and wheel zoom worked, and ordinary page scrolling
  returned after leaving the map.
- E12: A missing required answer displayed validation. A simulated failed
  photo upload offered retry and succeeded; an interrupted study request
  displayed Try again and recovered.

## Fixes and verification

- The boundary editor accepted the same corner twice and the API rejected it
  only after questionnaire review. It now reports the duplicate on the map
  before adding it, and checks again before advancing if corners were moved.
  Both the duplicate-add and overlapping-drag cases were reproduced and
  rechecked; correcting the corners allowed the wizard to continue.
- Component button styles overrode the HTML `hidden` attribute, leaving Load
  more visible for empty or exhausted dashboard groups. The shared hidden rule
  now preserves that attribute's expected behavior.
- `npm test`: 21 passed. `npm run build` and `git diff --check` passed.

Fixture sign-in is not a real Google or email authentication test. App Check,
live Overpass, physical-device GPS, physical-device layout, and a production
write journey were not verified by this run. Network failures and GPS
coordinates were deliberately simulated.
