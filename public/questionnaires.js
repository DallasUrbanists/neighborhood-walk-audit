// The catalog is only a starting point. Every authoring operation returns an
// independent study-owned copy, including copies of shared catalog questions.
export const AUDIT_TYPES = ['intersection', 'street-segment', 'point'];

export function createQuestionnaireState() {
  return { enabledTypes: [], questions: {}, nextId: 1 };
}

function copy(state) { return structuredClone(state); }
function requireType(type) {
  if (!AUDIT_TYPES.includes(type)) throw new Error('Unknown audit type.');
}
function append(state, type, definition) {
  const question = { ...structuredClone(definition.prompt), id: `q-${state.nextId++}` };
  if (definition.id) question.sourceQuestionId = definition.id;
  state.questions[type].push(question);
}

export function setTypeEnabled(original, type, enabled, bank) {
  requireType(type);
  const state = copy(original);
  if (enabled && !state.enabledTypes.includes(type)) {
    state.enabledTypes.push(type);
    if (!state.questions[type]) {
      state.questions[type] = [];
      for (const id of bank.defaults[type]) {
        const item = bank.questions.find(question => question.id === id && question.eligibleTypes.includes(type));
        if (!item) throw new Error(`Catalog question ${id} is unavailable for ${type}.`);
        append(state, type, item);
      }
    }
  } else if (!enabled) {
    state.enabledTypes = state.enabledTypes.filter(item => item !== type);
  }
  return state;
}

export function addBankQuestion(original, type, id, bank) {
  requireType(type);
  const state = copy(original);
  const item = bank.questions.find(question => question.id === id && question.eligibleTypes.includes(type));
  if (!item || !state.questions[type]) throw new Error('Question is unavailable for this audit type.');
  append(state, type, item);
  return state;
}

export function addCustomQuestion(original, type, kind = 'text') {
  requireType(type);
  const state = copy(original);
  if (!state.questions[type] || !['text', 'choice'].includes(kind)) throw new Error('Cannot add this question.');
  append(state, type, { prompt: kind === 'text'
    ? { type: 'text', label: '', required: false, maxLength: 2000 }
    : { type: 'choice', label: '', required: true, options: ['Yes', 'No'] } });
  return state;
}

export function updateQuestion(original, type, id, changes) {
  const state = copy(original);
  const index = state.questions[type]?.findIndex(question => question.id === id) ?? -1;
  if (index < 0) throw new Error('Question not found.');
  // IDs and provenance cannot be accidentally changed by an editor control.
  const { id: ignoredId, sourceQuestionId: ignoredSource, ...editable } = changes;
  Object.assign(state.questions[type][index], editable);
  return state;
}

export function removeQuestion(original, type, id) {
  const state = copy(original);
  state.questions[type] = (state.questions[type] || []).filter(question => question.id !== id);
  return state;
}

export function moveQuestion(original, type, id, delta) {
  const state = copy(original);
  const items = state.questions[type] || [];
  const from = items.findIndex(question => question.id === id);
  const to = from + delta;
  if (from >= 0 && Number.isInteger(delta) && to >= 0 && to < items.length) {
    items.splice(to, 0, items.splice(from, 1)[0]);
  }
  return state;
}

export function validateQuestionnaire(questions) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 30) return 'Choose between 1 and 30 questions.';
  const ids = new Set();
  for (const question of questions) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(question.id || '') || question.id.length > 100 || ids.has(question.id)) return 'Question IDs must be unique lowercase slugs.';
    ids.add(question.id);
    if (typeof question.label !== 'string' || !question.label.trim() || question.label.trim().length > 500) return 'Each question needs a label of at most 500 characters.';
    if (typeof question.required !== 'boolean') return 'Each question needs a required setting.';
    if (question.type === 'choice') {
      if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 50 || question.options.some(option => typeof option !== 'string' || !option.trim() || option.trim().length > 200) || new Set(question.options.map(option => option.trim())).size !== question.options.length) return 'Choice questions need 2 to 50 distinct, nonempty options.';
    } else if (question.type === 'text') {
      if (!Number.isInteger(question.maxLength) || question.maxLength < 1 || question.maxLength > 10000) return 'Text questions need a valid maximum length.';
    } else return 'Choose a supported question type.';
  }
  return null;
}

export function serializeQuestionnaires(state, bank) {
  if (!state.enabledTypes.length || new Set(state.enabledTypes).size !== state.enabledTypes.length) throw new Error('Select at least one audit type.');
  const questionnaires = {};
  for (const type of state.enabledTypes) {
    requireType(type);
    const questions = state.questions[type];
    const error = validateQuestionnaire(questions);
    if (error) throw new Error(error);
    const sources = {};
    const prompts = questions.map(({ sourceQuestionId, ...prompt }) => {
      if (sourceQuestionId) sources[prompt.id] = { sourceQuestionId };
      return structuredClone(prompt);
    });
    questionnaires[type] = { prompts, sourceMetadata: { catalogVersion: bank.version, questions: sources } };
  }
  return { allowedAuditTypes: [...state.enabledTypes], questionnaires };
}
