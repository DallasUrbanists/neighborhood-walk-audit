export const AARP_WORKSHEET_SOURCE =
  'https://www.aarp.org/livable-communities/getting-around/aarp-walk-audit-worksheets-english.html';

const scaleOptions = [
  { value: '1', label: '1 · Very poor' },
  { value: '2', label: '2 · Poor' },
  { value: '3', label: '3 · Fair' },
  { value: '4', label: '4 · Good' },
  { value: '5', label: '5 · Excellent' }
];

const yesNoUnsure = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' }
];

const commonClosingPrompts = [
  {
    id: 'priority',
    label: 'How urgently does this location need improvement?',
    type: 'choice',
    options: [
      { value: 'low', label: 'Low priority' },
      { value: 'medium', label: 'Medium priority' },
      { value: 'high', label: 'High priority' },
      { value: 'immediate', label: 'Immediate safety concern' }
    ]
  },
  {
    id: 'notes',
    label: 'What else should the study team know?',
    help: 'Describe a strength, problem, or suggested improvement.',
    type: 'textarea',
    optional: true,
    maxLength: 1200
  }
];

export const worksheetSeeds = [
  {
    slug: 'sidewalks-streets-crossings',
    title: 'Sidewalks, Streets, and Crossings',
    description: 'Review the basic walking route: sidewalk continuity, surfaces, crossings, and separation from traffic.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['intersection', 'street-segment'],
    prompts: [
      {
        id: 'sidewalk_present',
        label: 'Is there a usable sidewalk or walking path?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'surface_condition',
        label: 'How would you rate the walking surface?',
        help: 'Consider cracks, gaps, slopes, standing water, and tripping hazards.',
        type: 'choice',
        options: scaleOptions
      },
      {
        id: 'clear_width',
        label: 'Can two people comfortably pass each other?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'barriers',
        label: 'Which barriers are present?',
        help: 'Select every condition you observe.',
        type: 'multi-choice',
        options: [
          { value: 'poles', label: 'Poles or signs' },
          { value: 'vegetation', label: 'Overgrown vegetation' },
          { value: 'vehicles', label: 'Parked vehicles' },
          { value: 'debris', label: 'Debris or trash' },
          { value: 'construction', label: 'Construction blockage' },
          { value: 'none', label: 'No barriers observed' }
        ],
        optional: true
      },
      {
        id: 'crossing_accessible',
        label: 'Are crossings easy to find and usable for people with mobility devices?',
        type: 'choice',
        options: yesNoUnsure
      },
      ...commonClosingPrompts
    ]
  },
  {
    slug: 'intersection-safety',
    title: 'Intersection Safety',
    description: 'Observe visibility, crossing distance, signals, curb ramps, and turning traffic at an intersection.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['intersection'],
    prompts: [
      {
        id: 'visibility',
        label: 'Can people walking and driving clearly see one another?',
        type: 'choice',
        options: scaleOptions
      },
      {
        id: 'curb_ramps',
        label: 'Are curb ramps present, aligned, and in good condition?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'crosswalk',
        label: 'Is the crosswalk clearly marked and easy to follow?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'crossing_time',
        label: 'Is there enough time to cross at a comfortable pace?',
        type: 'choice',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'no_signal', label: 'No pedestrian signal' },
          { value: 'unsure', label: 'Not sure' }
        ]
      },
      {
        id: 'turning_conflicts',
        label: 'How often do turning vehicles conflict with people crossing?',
        type: 'choice',
        options: [
          { value: 'never', label: 'Never observed' },
          { value: 'rarely', label: 'Rarely' },
          { value: 'sometimes', label: 'Sometimes' },
          { value: 'often', label: 'Often' }
        ]
      },
      ...commonClosingPrompts
    ]
  },
  {
    slug: 'driver-behavior',
    title: 'Driver Behavior',
    description: 'Record speeds, yielding, turns, driveway conflicts, and other behavior that affects walking comfort.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['intersection', 'street-segment'],
    prompts: [
      {
        id: 'speed',
        label: 'How would you describe typical vehicle speeds?',
        type: 'choice',
        options: [
          { value: 'slow', label: 'Slow and comfortable' },
          { value: 'mixed', label: 'Mixed' },
          { value: 'fast', label: 'Fast or uncomfortable' },
          { value: 'no_traffic', label: 'No traffic observed' }
        ]
      },
      {
        id: 'yielding',
        label: 'Do drivers yield to people walking?',
        type: 'choice',
        options: [
          { value: 'consistently', label: 'Consistently' },
          { value: 'sometimes', label: 'Sometimes' },
          { value: 'rarely', label: 'Rarely or never' },
          { value: 'not_observed', label: 'Not observed' }
        ]
      },
      {
        id: 'behaviors',
        label: 'Which concerning behaviors did you observe?',
        type: 'multi-choice',
        options: [
          { value: 'speeding', label: 'Speeding' },
          { value: 'rolling_stop', label: 'Rolling through stop' },
          { value: 'phone', label: 'Phone distraction' },
          { value: 'blocked_crossing', label: 'Blocking a crossing' },
          { value: 'unsafe_turn', label: 'Unsafe turn' },
          { value: 'none', label: 'None observed' }
        ],
        optional: true
      },
      {
        id: 'driveway_conflicts',
        label: 'Do driveways create frequent conflicts along the walking route?',
        type: 'choice',
        options: yesNoUnsure
      },
      ...commonClosingPrompts
    ]
  },
  {
    slug: 'street-safety-appeal',
    title: 'Street Safety and Appeal',
    description: 'Assess lighting, shade, maintenance, activity, noise, and whether the street feels inviting to walk.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['street-segment'],
    prompts: [
      {
        id: 'comfort',
        label: 'How comfortable does this street feel for walking?',
        type: 'choice',
        options: scaleOptions
      },
      {
        id: 'shade',
        label: 'Is there useful shade from trees, awnings, or structures?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'lighting',
        label: 'Does the street appear adequately lit for walking after dark?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'things_to_see',
        label: 'Are there interesting or useful destinations along the route?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'maintenance',
        label: 'How well maintained is the public space?',
        type: 'choice',
        options: scaleOptions
      },
      ...commonClosingPrompts
    ]
  },
  {
    slug: 'transit-stop-access',
    title: 'Transit Stop Access',
    description: 'Review the walking connection to a bus or rail stop, including boarding space, seating, shade, and information.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['street-segment'],
    prompts: [
      {
        id: 'continuous_route',
        label: 'Is there a continuous accessible walking route to the stop?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'boarding_area',
        label: 'Is the boarding area level, clear, and large enough to use?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'amenities',
        label: 'Which stop amenities are present?',
        type: 'multi-choice',
        options: [
          { value: 'bench', label: 'Bench' },
          { value: 'shelter', label: 'Shelter' },
          { value: 'lighting', label: 'Lighting' },
          { value: 'route_info', label: 'Route information' },
          { value: 'trash', label: 'Trash receptacle' },
          { value: 'none', label: 'None of these' }
        ],
        optional: true
      },
      {
        id: 'safe_crossing',
        label: 'Can riders safely cross the street to reach both travel directions?',
        type: 'choice',
        options: yesNoUnsure
      },
      ...commonClosingPrompts
    ]
  },
  {
    slug: 'public-space',
    title: 'Public Spaces and Parks',
    description: 'Assess paths, entrances, seating, visibility, maintenance, and everyday access to a public space.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['street-segment'],
    prompts: [
      {
        id: 'entrance',
        label: 'Is the entrance easy to find and reach on foot?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'path_access',
        label: 'Are paths firm, stable, and usable by people with mobility devices?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'seating',
        label: 'Is comfortable seating available at useful intervals?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'visibility',
        label: 'Does the space have clear sightlines and feel well observed?',
        type: 'choice',
        options: scaleOptions
      },
      ...commonClosingPrompts
    ]
  },
  {
    slug: 'multiuse-paths-trails',
    title: 'Multiuse Paths and Trails',
    description: 'Review path width, surface, crossings, wayfinding, and interactions between people walking and rolling.',
    sourceUrl: AARP_WORKSHEET_SOURCE,
    recommendFor: ['street-segment'],
    prompts: [
      {
        id: 'width',
        label: 'Is the path wide enough for users to pass comfortably?',
        type: 'choice',
        options: yesNoUnsure
      },
      {
        id: 'surface',
        label: 'How would you rate the path surface?',
        type: 'choice',
        options: scaleOptions
      },
      {
        id: 'conflicts',
        label: 'Do speed differences create conflicts between path users?',
        type: 'choice',
        options: [
          { value: 'none', label: 'No conflicts observed' },
          { value: 'occasional', label: 'Occasional conflicts' },
          { value: 'frequent', label: 'Frequent conflicts' },
          { value: 'unsure', label: 'Not sure' }
        ]
      },
      {
        id: 'wayfinding',
        label: 'Are destinations, crossings, and route changes clearly marked?',
        type: 'choice',
        options: yesNoUnsure
      },
      ...commonClosingPrompts
    ]
  }
];
