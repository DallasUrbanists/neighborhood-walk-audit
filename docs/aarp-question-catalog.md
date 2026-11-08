# AARP walk audit question catalog

This proposed starter bank contains **56 original question definitions**: 16 for intersections, 18 for street segments, 18 for points, and four shared questions available to all three types. Study authors can select, change, remove, reorder, or replace these questions. The bank is a starting point; each study stores its own final questions.

The topics come from the [AARP Walk Audit Tool Kit worksheet collection](https://www.aarp.org/livable-communities/getting-around/aarp-walk-audit-worksheets-english.html) and its [11-page fillable PDF](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf), reviewed November 7, 2026. The collection bears a 2022 copyright. The prompts below are concise digital adaptations, not a transcription of AARP's forms or a claim of AARP endorsement. The three audit-type groups are this application's proposed classification.

## Source references

Each reference links to its page in AARP's published collection. Section descriptions in the question tables identify the relevant observations more precisely.

| Reference | AARP worksheet | Use in this application |
| --- | --- | --- |
| [A1](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=1) | Make a Map | Study boundary and audit location selection already provide the map; no duplicate map question. |
| [A2](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=2) | Who's Using the Street - and Why? | Optional descriptions of observed walking and rolling activities. |
| [A3](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=3) | Sidewalks, Streets and Crossings, single-location audit | Intersection access, crossings, and conditions at an individual point. |
| [A4](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=4) | Sidewalks, Streets and Crossings, walking audit | Conditions along a street segment. |
| [A5](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=5) | Sidewalks | Continuity, surface, passing space, obstacles, ramps, and warnings. |
| [A6](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=6) | Streets and Crossings | Crossing markings, controls, pedestrian signals, and timing. |
| [A7](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=7) | Street Safety and Appeal | Seating, shade, shelter, lighting, maintenance, and comfort. |
| [A8](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=8) | Public Transit Access | Access, protection from traffic, seating, shelter, upkeep, and comfort at stops. |
| [A9](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=9) | Build a Better Block | Open-ended suggestions for improvements. |
| [A10](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=10) | Winter Weather | Seasonal walkway, crossing, and stop access questions. |
| [A11](https://www.aarp.org/content/dam/aarp/livable-communities/getting-around/2022/walk-audit-worksheets-english/Walk%20Audit%20Worksheets%20Collection-fillable.pdf#page=11) | Summary | Overall assessment and observations; report totals should be computed, not entered twice. |

## Answer formats

Use the shared API's existing `choice` and `text` formats for the 2.5-hour implementation:

- **YN**: single choice, `Yes`, `No`, `Not applicable`, `Not observed / unsure`. The last two are distinct answers, never silently treated as `No`.
- **Rating**: single choice, `Easy and comfortable`, `Some difficulties`, `Difficult or uncomfortable`, `Not observed / unsure`.
- **Coverage**: single choice, `Neither side`, `Some sections only`, `One side throughout`, `Both sides throughout`, `Not observed / unsure`.
- **Text**: optional text, maximum 2,000 characters. A timing question may request seconds in its label but remains a text response in this release.

Selected choice questions default to required because they include an explicit way to report uncertainty or inapplicability. Authors can change the required setting and the options. Text questions default to optional. These choices adapt AARP's yes/no/other and skip guidance for a digital form; they do not reproduce an official AARP score.

## Intersection questions

Apply these to a mapped meeting of streets. Authors can also add any of the four shared questions below.

| Stable ID | Proposed question | Format | Source topic |
| --- | --- | --- | --- |
| `i-crosswalk-present` | Is there a designated pedestrian crossing here? | YN | A6, street crossings |
| `i-crosswalk-visible` | Can pedestrians and drivers readily identify the crossing markings? | YN | A6, marking visibility |
| `i-controls-visible` | Are the traffic controls easy to see from the crossing? | YN | A6, lights and signs |
| `i-pedestrian-signal` | Does this crossing have a signal for pedestrians? | YN | A6, signal presence |
| `i-signal-working` | Does the pedestrian signal appear to operate correctly? | YN | A6, signal operation |
| `i-push-button` | Can a pedestrian request a crossing using a working button? | YN | A6, signal controls |
| `i-audible-signal` | Does the signal provide an audible crossing cue? | YN | A6, audible prompts |
| `i-crossing-time` | Does the signal allow a comfortable amount of time to reach the far side? | YN | A6, crossing duration |
| `i-wait-time` | Approximately how many seconds did you wait for a crossing opportunity? | Text | A6, waiting time |
| `i-curb-ramp` | Can someone using wheels enter and leave the crossing by a usable ramp? | YN | A3/A5, curb access |
| `i-tactile-warning` | Are detectable warning surfaces present where the sidewalk meets the crossing? | YN | A3/A5, tactile indicators |
| `i-refuge` | Is there a protected place to pause partway across this road? | YN | A3, median or island |
| `i-speed-compliance` | Do observed drivers appear to follow the posted speed limit? | YN | A3, speed observation |
| `i-lighting` | Does the crossing have lighting intended for people walking? | YN | A7, pedestrian lighting |
| `i-winter-crosswalk` | Is the crossing route visible and free of snow or ice? | YN | A10, winter crossing visibility |
| `i-winter-visibility` | Can drivers see people crossing despite snowbanks or other winter obstructions? | YN | A10, pedestrian visibility |

## Street segment questions

Apply these once to the entire shortest street path selected with two pins: a start intersection and an end point that may be midblock. The selected segment can contain multiple saved street edges. References to "this segment" below mean that selected route as a whole.

| Stable ID | Proposed question | Format | Source topic |
| --- | --- | --- | --- |
| `s-sidewalk-coverage` | Where are sidewalks available along this segment? | Coverage | A4/A5, sidewalk availability |
| `s-continuity` | Can you follow the sidewalk for the full segment without an unexplained gap or ending? | YN | A4/A5, continuity |
| `s-buffer` | Is there a curb, planted strip, or another buffer beside moving traffic? | YN | A4/A5, separation |
| `s-surface` | Is the walking surface even and in usable condition along the segment? | YN | A4/A5, surface and repair |
| `s-obstacles` | Is the walking route clear of objects or growth that block passage? | YN | A4/A5, obstructions |
| `s-driveways` | Can you follow the sidewalk without repeated interruptions at driveways? | YN | A4/A5, driveway interruptions |
| `s-passing-space` | Is there enough clear space for two people to pass comfortably? | YN | A4/A5, sidewalk width |
| `s-bike-lane` | Is a designated bicycle lane present along this segment? | YN | A4/A6, bicycle lane |
| `s-shade` | Is shade available along the walking route? | YN | A7, shade trees |
| `s-seating` | Are there places to rest along this segment? | YN | A7, seating |
| `s-lighting` | Is pedestrian lighting provided along the route? | YN | A7, lighting |
| `s-greenery` | Does the landscaping along the route appear maintained? | YN | A7, landscape upkeep |
| `s-route-comfort` | Does this segment feel inviting to walk along? | YN | A7, travel-route impressions |
| `s-speed-compliance` | Do observed drivers appear to follow the speed limit on this segment? | YN | A4/A7, speed observation |
| `s-winter-width` | Has snow or ice been cleared across the usable width of the walkway? | YN | A10, width clearance |
| `s-winter-length` | Has snow or ice been cleared for the full length of the walkway? | YN | A10, length clearance |
| `s-winter-treatment` | Is there visible treatment for slippery winter surfaces? | YN | A10, salting and sanding |
| `s-transit-connection` | Can pedestrians safely reach nearby transit stops from this segment? | YN | A8, access to transit |

## Point questions

Apply these to one coordinate on a mapped street segment, including a midblock crossing, sidewalk defect, driveway, entrance, bench, or transit stop. An intersection is not required. Crossing and transit questions can return `Not applicable` at other locations.

| Stable ID | Proposed question | Format | Source topic |
| --- | --- | --- | --- |
| `p-passage` | Can a person using a mobility aid pass through this spot? | YN | A3/A5, local walking access |
| `p-surface` | Is the surface at this spot even and usable? | YN | A3/A5, surface condition |
| `p-obstacles` | Is this spot free of objects or vegetation that block walking? | YN | A3/A5, obstructions |
| `p-curb-ramp` | Is a usable ramp available if a curb interrupts the route here? | YN | A3/A5, curb access |
| `p-tactile-warning` | Is there a detectable warning surface where the path enters traffic here? | YN | A3/A5, tactile indicators |
| `p-midblock-crossing` | Is a pedestrian crossing provided at this spot? | YN | A6, crossing presence |
| `p-crossing-visible` | Can drivers and pedestrians readily identify the crossing at this spot? | YN | A6, crossing visibility |
| `p-shade` | Does this spot offer shade? | YN | A7, shade |
| `p-seating` | Is there a usable place to sit at this spot? | YN | A7, seating |
| `p-shelter` | Is shelter from the weather available here? | YN | A7, weather protection |
| `p-lighting` | Is pedestrian lighting provided at this spot? | YN | A7, lighting |
| `p-transit-access` | Can pedestrians safely approach and leave this transit stop? | YN | A8, stop access |
| `p-transit-protection` | Are people waiting here protected from moving traffic? | YN | A8, waiting-area protection |
| `p-transit-seat` | Does this stop provide suitable seating for waiting riders? | YN | A8, stop seating |
| `p-transit-shelter` | Does this stop provide shelter for waiting riders? | YN | A8, stop shelter |
| `p-transit-upkeep` | Does this stop appear clean and maintained? | YN | A8, stop maintenance |
| `p-transit-comfort` | Would you feel comfortable waiting at this stop? | YN | A8, waiting comfort |
| `p-winter-access` | Is access through this spot clear of snowbanks, ice, or piled snow? | YN | A10, walkway and stop access |

## Shared questions

Offer these in each type's picker, with a separate study-specific copy for each type. Including a shared question for intersections does not select it for points or segments.

| Stable ID | Proposed question | Format | Source topic |
| --- | --- | --- | --- |
| `common-walkability` | Overall, how easy and comfortable is walking at this location? | Rating | A3-A8/A11, overall assessment |
| `common-improvements` | What changes would most improve walking here? | Text | A9, possible improvements |
| `common-observations` | What other observations should the study team consider? | Text | A5-A8/A11, observation notes |
| `common-activities` | What walking or rolling activities did you observe here? | Text | A2, observed use |

## Default selections

Preselect small useful sets, then let the author change everything before study creation:

- **Intersection, seven questions:** `i-crosswalk-visible`, `i-controls-visible`, `i-curb-ramp`, `i-tactile-warning`, `i-crossing-time`, `common-walkability`, `common-improvements`.
- **Street segment, eight questions:** `s-sidewalk-coverage`, `s-continuity`, `s-buffer`, `s-surface`, `s-obstacles`, `s-passing-space`, `common-walkability`, `common-improvements`.
- **Point, six questions:** `p-surface`, `p-obstacles`, `p-shade`, `p-lighting`, `common-walkability`, `common-improvements`.

The full picker consequently offers 20 intersection questions, 22 street-segment questions, and 22 point questions. No bank question is mandatory; an author can use an entirely custom questionnaire with at least one question for every enabled type.

## Encoding during implementation

Convert these definitions into a versioned static JSON bank in the frontend's public assets. Give each entry its stable `id`, eligible audit types, topic, prompt definition, and source metadata containing the AARP collection URL, worksheet numbers, section/topic, and adaptation note. Record catalog version `aarp-topics-v1`. Keep the source ID stable when an author changes wording; use a separate study question ID and a `sourceQuestionId` reference. Custom questions have no source reference.

Store the submitted prompt wording, order, required flags, answer options, and source references with the study's frozen worksheet. Rendering a submitted audit must not depend on the current bank or a future version of the AARP website. Community name, boundary, location, contributor, and submission timestamps already have application fields and should not be duplicated as questionnaire prompts.

The 2.5-hour release curates representative questions rather than reproducing every AARP checklist item. Structured people counts, multiple-selection improvements, conditional signal/transit follow-ups, and the separate multiuse-path supplement can follow later. Authors can express additional observations as text questions immediately. Optional attachments of up to three photos per audit are included independently of the question bank. See the [implementation plan](./study-questionnaires-implementation-plan.md) for photos, route selection, immutable audit types, persistence, migration, validation, and delivery sequencing.
