// Record types and their fields. Edit this file to change what gets recorded —
// the forms, lists and exports are all generated from it.
//
// Field options:
//   key, label, type (text|textarea|number|select|date|time|checkbox|contextRef)
//   options (for select), hint, required, wide (span full width), showIf(record)

export const CONTEXT_TYPES = ['Cut', 'Fill', 'Layer', 'Deposit', 'Masonry', 'Timber', 'Skeleton', 'Other'];

const isDeposit = (r) => ['Fill', 'Layer', 'Deposit'].includes(r.contextType);
const isCut = (r) => r.contextType === 'Cut';
const isMasonry = (r) => r.contextType === 'Masonry';

export const RELATIONSHIPS = {
  above: 'Above (later than)',
  below: 'Below (earlier than)',
  cuts: 'Cuts',
  cutBy: 'Cut by',
  fills: 'Fills',
  filledBy: 'Filled by',
  abuts: 'Abuts',
  abuttedBy: 'Abutted by',
  sameAs: 'Same as',
};

// Each relationship and what it means from the other context's point of view.
export const RECIPROCAL = {
  above: 'below', below: 'above',
  cuts: 'cutBy', cutBy: 'cuts',
  fills: 'filledBy', filledBy: 'fills',
  abuts: 'abuttedBy', abuttedBy: 'abuts',
  sameAs: 'sameAs',
};

// Which relationships imply "this context is later than the other" (for the matrix check).
export const LATER_THAN = ['above', 'cuts', 'fills'];

const common = {
  recorder: { key: 'recorder', label: 'Recorded by', type: 'text', hint: 'Initials' },
  date: { key: 'date', label: 'Date', type: 'date' },
  notes: { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
};

export const TYPES = {
  context: {
    label: 'Context',
    plural: 'Contexts',
    prefix: '',
    startNumber: 1000,
    location: true,
    summary: (r) => [r.contextType, r.interpretation].filter(Boolean).join(' — '),
    fields: [
      { key: 'contextType', label: 'Type', type: 'select', options: CONTEXT_TYPES, required: true },
      { key: 'trench', label: 'Trench / Area', type: 'text' },
      { key: 'feature', label: 'Feature / Group no.', type: 'text' },
      { key: 'sondage', label: 'Intervention / Segment', type: 'text' },

      // Deposit description
      { key: 'colour', label: 'Colour', type: 'text', hint: 'e.g. mid greyish brown', showIf: isDeposit },
      { key: 'composition', label: 'Composition', type: 'select', showIf: isDeposit,
        options: ['Clay', 'Silty clay', 'Clayey silt', 'Silt', 'Sandy silt', 'Silty sand', 'Sand', 'Gravel', 'Loam', 'Peat', 'Other'] },
      { key: 'compaction', label: 'Compaction', type: 'select', showIf: isDeposit,
        options: ['Loose', 'Friable', 'Moderately compact', 'Compact', 'Firm', 'Hard', 'Plastic'] },
      { key: 'inclusions', label: 'Inclusions', type: 'textarea', wide: true, showIf: isDeposit,
        hint: 'Frequency, size, type — e.g. occasional sub-angular flint pebbles <20 mm, rare charcoal flecks' },

      // Cut description
      { key: 'shapePlan', label: 'Shape in plan', type: 'text', showIf: isCut, hint: 'e.g. sub-circular, linear' },
      { key: 'sides', label: 'Sides', type: 'text', showIf: isCut, hint: 'e.g. steep, concave' },
      { key: 'base', label: 'Base', type: 'text', showIf: isCut, hint: 'e.g. flat, rounded' },
      { key: 'breakTop', label: 'Break of slope (top)', type: 'text', showIf: isCut },
      { key: 'breakBase', label: 'Break of slope (base)', type: 'text', showIf: isCut },
      { key: 'orientation', label: 'Orientation', type: 'text', showIf: isCut, hint: 'e.g. NE–SW' },

      // Masonry
      { key: 'materials', label: 'Materials', type: 'text', showIf: isMasonry },
      { key: 'bond', label: 'Bond / Coursing', type: 'text', showIf: isMasonry },
      { key: 'bonding', label: 'Bonding material', type: 'text', showIf: isMasonry },

      { key: 'length', label: 'Length (m)', type: 'number' },
      { key: 'width', label: 'Width / Diameter (m)', type: 'number' },
      { key: 'depth', label: 'Depth / Thickness (m)', type: 'number' },
      { key: 'levelTop', label: 'Top level (m OD)', type: 'number' },
      { key: 'levelBase', label: 'Base level (m OD)', type: 'number' },

      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      { key: 'interpretation', label: 'Interpretation', type: 'text', wide: true },
      { key: 'excavationMethod', label: 'Method', type: 'select',
        options: ['Hand — 50%', 'Hand — 100%', 'Hand — slot', 'Machine', 'Unexcavated'] },
      { key: 'finds', label: 'Finds present', type: 'checkbox' },
      { key: 'samples', label: 'Samples taken', type: 'checkbox' },
      { key: 'datingEvidence', label: 'Dating evidence', type: 'text', wide: true },
      common.recorder, common.date, common.notes,
    ],
  },

  find: {
    label: 'Find',
    plural: 'Finds',
    prefix: 'SF',
    startNumber: 1,
    location: true,
    summary: (r) => [r.material, r.objectType, r.context && `context ${r.context}`].filter(Boolean).join(' — '),
    fields: [
      { key: 'context', label: 'Context', type: 'contextRef', required: true },
      { key: 'material', label: 'Material', type: 'select',
        options: ['Pottery', 'CBM', 'Animal bone', 'Human bone', 'Flint / Lithic', 'Glass', 'Copper alloy', 'Iron', 'Lead', 'Silver', 'Gold', 'Worked stone', 'Wood', 'Leather', 'Shell', 'Other'] },
      { key: 'objectType', label: 'Object', type: 'text', hint: 'e.g. brooch, coin, sherd' },
      { key: 'count', label: 'Count', type: 'number' },
      { key: 'period', label: 'Period (field ID)', type: 'text' },
      { key: 'levelZ', label: 'Level (m OD)', type: 'number' },
      { key: 'bagged', label: 'Bagged & labelled', type: 'checkbox' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      common.recorder, common.date,
    ],
  },

  sample: {
    label: 'Sample',
    plural: 'Samples',
    prefix: 'S',
    startNumber: 1,
    location: true,
    summary: (r) => [r.sampleType, r.context && `context ${r.context}`, r.volume && `${r.volume} L`].filter(Boolean).join(' — '),
    fields: [
      { key: 'context', label: 'Context', type: 'contextRef', required: true },
      { key: 'sampleType', label: 'Type', type: 'select',
        options: ['Bulk (environmental)', 'Monolith', 'Kubiena', 'Spot', 'Radiocarbon', 'OSL', 'Archaeomagnetic', 'Other'] },
      { key: 'purpose', label: 'Purpose', type: 'text', hint: 'e.g. charred plant remains' },
      { key: 'volume', label: 'Volume (litres)', type: 'number' },
      { key: 'containers', label: 'No. of tubs / bags', type: 'number' },
      { key: 'percentOfDeposit', label: '% of deposit', type: 'number' },
      { key: 'levelZ', label: 'Level (m OD)', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      common.recorder, common.date,
    ],
  },

  photo: {
    label: 'Photo',
    plural: 'Photos',
    prefix: 'P',
    startNumber: 1,
    location: true,
    hasImages: true,
    summary: (r) => [r.subject, r.facing && `facing ${r.facing}`].filter(Boolean).join(' — '),
    fields: [
      { key: 'subject', label: 'Subject', type: 'text', wide: true, required: true },
      { key: 'contexts', label: 'Contexts shown', type: 'text', hint: 'e.g. 1001, 1002' },
      { key: 'facing', label: 'Facing', type: 'select', options: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'Vertical'] },
      { key: 'scales', label: 'Scales', type: 'text', hint: 'e.g. 1 × 1 m, 1 × 0.5 m' },
      { key: 'cameraRef', label: 'Camera file no.', type: 'text', hint: 'If taken on a separate camera' },
      common.recorder, common.date,
    ],
  },

  drawing: {
    label: 'Drawing',
    plural: 'Drawings',
    prefix: 'D',
    startNumber: 1,
    location: false,
    summary: (r) => [r.drawingType, r.scale, r.contexts].filter(Boolean).join(' — '),
    fields: [
      { key: 'drawingType', label: 'Type', type: 'select', options: ['Plan', 'Section', 'Elevation', 'Profile', 'Other'] },
      { key: 'scale', label: 'Scale', type: 'select', options: ['1:5', '1:10', '1:20', '1:50', '1:100', 'Other'] },
      { key: 'sheet', label: 'Sheet no.', type: 'text' },
      { key: 'contexts', label: 'Contexts shown', type: 'text', hint: 'e.g. 1001, 1002' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      common.recorder, common.date,
    ],
  },
};

export const PROJECT_FIELDS = [
  { key: 'siteCode', label: 'Site code', type: 'text', required: true, hint: 'e.g. ABC26' },
  { key: 'name', label: 'Site name', type: 'text', required: true, wide: true },
  { key: 'client', label: 'Client', type: 'text' },
  { key: 'projectType', label: 'Project type', type: 'select',
    options: ['Evaluation', 'Excavation', 'Strip, map & sample', 'Watching brief', 'Test pitting', 'Building recording', 'Other'] },
  { key: 'ngr', label: 'Central NGR', type: 'text', hint: 'e.g. SP 12345 67890' },
  { key: 'her', label: 'HER / Planning ref.', type: 'text' },
  { key: 'supervisor', label: 'Site supervisor', type: 'text' },
  { key: 'startDate', label: 'Start date', type: 'date' },
];
