import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryRepository } from '../src/repository.js';

const emptyCollection = { type: 'FeatureCollection', features: [] };
const target = {
  type: 'Feature',
  properties: { id: 'intersection-42' },
  geometry: { type: 'Point', coordinates: [-96.8, 32.78] }
};

test('saves, submits, and edits an audit draft', async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ name: 'Jamie Walker', email: 'jamie@example.com' });
  const study = await repository.createStudy({
    neighborhood: 'Test Neighborhood',
    createdBy: user.id,
    locationGps: { latitude: 32.78, longitude: -96.8 },
    locationDescription: 'Test area',
    area: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-96.81, 32.77], [-96.79, 32.77], [-96.79, 32.79], [-96.81, 32.79], [-96.81, 32.77]]] } },
    intersections: { type: 'FeatureCollection', features: [target] },
    segments: emptyCollection,
    thumbnailPng: null
  });
  const [worksheet] = await repository.listWorksheets('intersection');
  const draft = await repository.createDraft({ studyId: study.id, userId: user.id });
  await repository.updateDraft(draft.id, user.id, {
    type: 'intersection',
    worksheetId: worksheet.id,
    locationGps: { latitude: 32.78, longitude: -96.8 },
    locationDescription: 'Intersection of Main Street and Oak Avenue',
    geojson: target,
    answers: { priority: 'high' }
  });
  const audit = await repository.submitDraft(draft.id, user.id);
  assert.equal(audit.locationDescription, 'Intersection of Main Street and Oak Avenue');
  assert.equal(audit.answers.priority, 'high');

  const editDraft = await repository.createDraft({
    studyId: study.id,
    userId: user.id,
    editingAuditId: audit.id
  });
  await repository.updateDraft(editDraft.id, user.id, { locationDescription: 'Updated intersection description' });
  const updated = await repository.submitDraft(editDraft.id, user.id);
  assert.equal(updated.id, audit.id);
  assert.equal(updated.locationDescription, 'Updated intersection description');
  assert.equal((await repository.listAudits(study.id)).length, 1);
});
