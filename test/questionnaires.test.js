import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createQuestionnaireState, setTypeEnabled, addBankQuestion, addCustomQuestion, updateQuestion, removeQuestion, moveQuestion, serializeQuestionnaires, validateQuestionnaire } from '../public/questionnaires.js';

const bank = JSON.parse(await readFile(new URL('../public/question-bank.json', import.meta.url), 'utf8'));

test('catalog has the complete eligible sets and documented defaults', () => {
  assert.equal(bank.version, 'aarp-topics-v1');
  assert.equal(bank.questions.length, 56);
  assert.equal(new Set(bank.questions.map(question => question.id)).size, 56);
  for (const [type, eligible, defaults] of [['intersection', 20, 7], ['street-segment', 22, 8], ['point', 22, 6]]) {
    assert.equal(bank.questions.filter(question => question.eligibleTypes.includes(type)).length, eligible);
    assert.equal(bank.defaults[type].length, defaults);
  }
});

test('study questions are independent across types and from the bank, including toggles', () => {
  let state = setTypeEnabled(createQuestionnaireState(), 'intersection', true, bank);
  state = setTypeEnabled(state, 'point', true, bank);
  const first = state.questions.intersection.find(question => question.sourceQuestionId === 'common-walkability');
  const second = state.questions.point.find(question => question.sourceQuestionId === 'common-walkability');
  assert.notEqual(first.id, second.id);
  state = updateQuestion(state, 'intersection', first.id, { label: 'Changed', options: ['Good', 'Poor'] });
  state = setTypeEnabled(state, 'intersection', false, bank);
  assert.equal(serializeQuestionnaires(state, bank).questionnaires.intersection, undefined);
  state = setTypeEnabled(state, 'intersection', true, bank);
  assert.equal(state.questions.intersection.find(question => question.id === first.id).label, 'Changed');
  assert.notEqual(state.questions.point.find(question => question.id === second.id).label, 'Changed');
  assert.notEqual(bank.questions.find(question => question.id === 'common-walkability').prompt.label, 'Changed');
});

test('editing, ordering, removal, custom questions and provenance serialize correctly', () => {
  let state = setTypeEnabled(createQuestionnaireState(), 'point', true, bank);
  for (const question of [...state.questions.point]) state = removeQuestion(state, 'point', question.id);
  assert.throws(() => serializeQuestionnaires(state, bank), /1 and 30/);
  state = addBankQuestion(state, 'point', 'p-passage', bank);
  state = addCustomQuestion(state, 'point', 'choice');
  const custom = state.questions.point[1];
  state = updateQuestion(state, 'point', custom.id, { label: 'Custom question?', options: ['One', 'Two'], required: false });
  state = moveQuestion(state, 'point', custom.id, -1);
  const saved = serializeQuestionnaires(state, bank).questionnaires.point;
  assert.equal(saved.prompts[0].label, 'Custom question?');
  assert.equal(saved.prompts[0].required, false);
  assert.equal(saved.sourceMetadata.questions[saved.prompts[1].id].sourceQuestionId, 'p-passage');
  assert.equal(saved.prompts[1].sourceQuestionId, undefined);
});

test('invalid selections, duplicate IDs and invalid options are rejected', () => {
  assert.throws(() => serializeQuestionnaires(createQuestionnaireState(), bank), /at least one/);
  const question = { id: 'q-1', type: 'choice', label: 'A?', required: true, options: ['Yes', 'No'] };
  assert.match(validateQuestionnaire([question, { ...question }]), /unique/);
  assert.match(validateQuestionnaire([{ ...question, options: ['Yes'] }]), /2 to 50/);
  assert.match(validateQuestionnaire([{ ...question, options: ['Yes', 'Yes'] }]), /distinct/);
});
