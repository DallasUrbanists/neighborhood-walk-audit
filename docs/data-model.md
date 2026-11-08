# Data model

The table below describes the retained standalone backend. The shared API uses
the separate `walk_audit_*` tables and the additional contracts described after
the table.

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

## Shared API additions

`walk_audit_study_questionnaires` pins a worksheet and provenance to each
enabled study/type pair. Study-owned worksheet copies are excluded from global
template lists; submitted audits retain their original worksheet IDs. The
enabled types are the assignment rows, with no separate type array to drift out
of sync. The catalog in this repository is used only while authoring: the final
prompts and string answer options are saved with the study.

Point observations store a Point on a named saved street edge. Routed street
observations store their start intersection, end edge and coordinate, ordered
edge fractions, length, and canonical LineString. Coverage unions intervals per
edge, while point observations and passed intersections do not complete a
street or intersection target. A null route on an older street audit retains
its historical single-edge location.

`walk_audit_photos` stores at most three binary slots with a private draft or a
submitted audit as parent. Draft access is owner-only; submitted photos are
public. Photo mutations share the draft version, submission transfers the rows
transactionally, and report snapshots contain descriptors rather than bytes.
