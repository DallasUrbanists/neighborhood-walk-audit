# Data model

| Entity | Purpose | Key relationships |
| --- | --- | --- |
| `users` | Stores contributor and organizer identity entered through the low-security email flow. | Creates studies, drafts, and audits. |
| `studies` | Stores the neighborhood, study boundary, OSM intersections and segments, centroid description, and PNG thumbnail. | Belongs to one organizer; has many audits and reports. |
| `worksheets` | Reusable interactive form definitions with recommended audit types and source links. | Selected by drafts and audits. |
| `audit_drafts` | Server-side autosave state for an unfinished new or edited audit. | Belongs to a user and study; may point to an audit being edited. |
| `audits` | A submitted observation for one intersection or street segment. | Belongs to a study, contributor, and worksheet. |
| `reports` | An immutable snapshot of study audit IDs, overall completion, and a narrative summary. | Belongs to a study. |

GeoJSON is stored as `JSONB`. The mapped feature’s `properties.id` connects submitted audits to the original intersection or segment for completion calculations and green map overlays.

Audit answers are stored as a JSON object keyed by worksheet prompt ID. This lets worksheet templates evolve without creating a database column for every question.
