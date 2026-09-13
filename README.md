# Neighborhood Walk Audit

A mobile-first web application for organizing a neighborhood-wide walk audit. Organizers draw one study boundary and share its link; volunteers can then audit individual street segments or intersections on their own schedules.

## What is included

- Email-only sign-in, with a name prompt for first-time users
- A personal dashboard of organized and contributed studies
- A two-step study wizard with touch-first boundary drawing
- OpenStreetMap street and intersection extraction through the Overpass API
- Automatically generated PNG study thumbnails
- Public, copyable study links
- GPS-assisted audit location selection that snaps to the nearest mapped intersection or street segment
- Type-filtered digital walk-audit worksheets based on AARP worksheet topics
- One-question-at-a-time mobile forms with progress indicators
- Database autosave after every completed step or question
- offline drafts in `localStorage`, an ordered sync queue, and automatic reconnection sync
- Review and edit links before submission
- Study progress, completed-location map overlays, audit history, audit details, and audit editing
- On-demand report snapshots for study organizers
- Optional AI-assisted report narratives, with a reliable built-in summary fallback
- Light and dark themes designed for outdoor legibility
- Installable web-app metadata and offline caching for the app shell and recently viewed map tiles

## Technology

- Node.js and Express
- PostgreSQL
- Leaflet with CARTO light/dark basemap tiles
- Turf for GeoJSON validation, centroids, area checks, and OpenStreetMap processing
- Bulma plus project-specific responsive styles
- Native browser Geolocation, Service Worker, Clipboard, and Local Storage APIs
- Render Blueprint configuration in `render.yaml`

## Run locally

Requirements: Node.js 20 or newer and, for persistent data, PostgreSQL.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm start
```

Open `http://localhost:3000`.

If `DATABASE_URL` is absent, the app starts in an in-memory preview mode. Sign in as `organizer@example.com` to see the included sample study. Preview-mode changes disappear when the server restarts.

## PostgreSQL setup

1. Create a database named `walk_audit`.
2. Put its connection string in `.env` as `DATABASE_URL`.
3. Set `COOKIE_SECRET` to a long random value.
4. Run `npm run db:migrate` before starting the server.

Migrations are applied once and recorded in `schema_migrations`. Worksheet records are updated from `src/worksheets.js` whenever the server starts.

## Deploy on Render

The included `render.yaml` defines the web service and PostgreSQL database.

1. Push this project to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Approve the web service and database resources.
4. Set `APP_ORIGIN` to the final `https://…onrender.com` origin.
5. Deploy. Render will install packages, run the migrations, and start the app.

The supplied database plan is suitable for an early deployment; choose a larger plan as the number or size of study GeoJSON records grows.

## Mobile map interaction

The boundary tool deliberately separates panning from drawing. Volunteers pan and pinch normally, line up a fixed crosshair, and tap the large **Add corner** control. This prevents accidental polygon points during one-finger map movement. Added corners remain large and draggable.

The audit location map requests high-accuracy device GPS, provides a large draggable pin and location button, and highlights the closest eligible map feature. All critical controls are at least 52 pixels high, remain near the bottom thumb zone, honor safe-area insets, and do not depend on hover.

## OpenStreetMap processing

Study creation sends the polygon to the Overpass API and requests common walk-auditable street types. The server:

1. validates the GeoJSON polygon and area size;
2. identifies OSM nodes shared by multiple highway ways as intersections;
3. splits ways at those nodes into auditable street segments;
4. adds stable OSM-derived feature IDs and readable descriptions; and
5. stores both FeatureCollections with the study.

The default Overpass endpoint can be changed with `OVERPASS_URL`. A fallback endpoint is used if the configured endpoint is temporarily unavailable.

## AI-assisted report descriptions

Reports work without an AI service by producing a factual summary from completion and audit data. To enable AI assistance, set `REPORT_AI_ENDPOINT` to an HTTPS endpoint that accepts the documented study snapshot as JSON and returns `{ "description": "…" }`. If the service requires a bearer token, set `REPORT_AI_TOKEN`. Timeouts, invalid output, or service errors automatically fall back to the built-in summary so report creation is never blocked.

## Data and security notes

This version intentionally follows the specification’s low-security, passwordless email entry flow. It identifies a browser using a signed, HTTP-only cookie, but it does **not** prove ownership of an email address. Do not use it for sensitive or adversarial deployments. A later production hardening phase should add verified magic links or another identity provider and replace the in-memory request controls with shared rate limiting.

The app does not store device location until an audit step is saved. Public study and audit pages expose contributor display names, audit timestamps, locations, and answers as required by the study activity specification; email addresses are never returned on those pages.

## Worksheet source

The seeded forms are concise digital adaptations of the topics covered by the [AARP Walk Audit Tool Kit worksheets](https://www.aarp.org/livable-communities/getting-around/aarp-walk-audit-worksheets-english.html). They link contributors back to AARP’s source collection. Prompt wording in this project is original and can be replaced or expanded by editing `src/worksheets.js`.

## Tests

```bash
npm test
```

The test suite covers study-area validation, Overpass-to-GeoJSON street splitting, thumbnail output, and the in-memory repository’s draft/submission/edit flow.
