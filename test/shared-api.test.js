import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedApi } from '../public/shared-api.js';

const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const auth = { user: () => ({ uid: 'firebase-user' }), headers: async () => ({ Authorization: 'Bearer refreshed-token', 'X-Firebase-AppCheck': 'attestation' }), signOut: async () => {} };

test('maps actual worksheet schema and follows pagination without authenticating public reads', async () => {
  const requests = [];
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    const second = url.searchParams.get('offset') === '1';
    return response({ worksheets: [{ id: second ? 42 : 7, version: 3, prompts: [{ id: 'comfort', type: 'choice', required: true, options: ['comfortable', 'mixed'] }, { id: 'notes', type: 'text', required: false }] }], hasMore: !second });
  } });
  const { worksheets } = await client.request('/api/worksheets?type=intersection');
  assert.equal(worksheets.length, 2);
  assert.equal(requests[1].url.searchParams.get('offset'), '1');
  assert.equal(requests[0].url.searchParams.get('type'), 'intersection');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(worksheets[0].prompts[1].type, 'textarea');
  assert.deepEqual(worksheets[0].prompts[0].options[1], { value: 'mixed', label: 'mixed' });
});

test('serializes draft versions, derives the network feature and sends only expectedVersion on submit', async () => {
  const writes = [];
  let draft = { id: 'draft-a', version: 1, type: null, answers: {}, featureId: null, locationGps: null, geojson: null };
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer refreshed-token');
    if (options.method === 'GET') return response({ draft });
    const body = JSON.parse(options.body);
    writes.push({ url: url.pathname, body });
    assert.equal(body.expectedVersion, draft.version);
    if (url.pathname.endsWith('/submit')) return response({ audit: { id: 12 } }, 201);
    draft = { ...draft, ...body, version: draft.version + 1 };
    return response({ draft });
  } });
  await client.request('/api/drafts/draft-a');
  await Promise.all([
    client.request('/api/drafts/draft-a', { method: 'PATCH', body: { type: 'intersection' } }),
    client.request('/api/drafts/draft-a', { method: 'PATCH', body: { geojson: { type: 'Feature', properties: { id: 'node-10' }, geometry: { type: 'Point', coordinates: [-96.8, 32.78] } } } })
  ]);
  assert.equal(writes[1].body.featureId, 'node-10');
  assert.deepEqual(writes[1].body.locationGps, { longitude: -96.8, latitude: 32.78 });
  await client.request('/api/drafts/draft-a/submit', { method: 'POST', body: { editing: true } });
  assert.deepEqual(writes[2].body, { expectedVersion: 3 });
});

test('does not invent a study after a failed POST or automatically retry a mutation', async () => {
  let attempts = 0;
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async () => { attempts++; throw new Error('connection reset'); } });
  await assert.rejects(client.request('/api/studies', { method: 'POST', body: { neighborhood: 'Test', area: {} } }), error => error.isNetworkError);
  assert.equal(attempts, 1);
});

test('profile registration race reads the token-owned profile without claiming legacy identity', async () => {
  const bodies = [];
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (_url, options) => {
    if (options.method === 'POST') { bodies.push(JSON.parse(options.body)); return response({ error: 'CONFLICT' }, 409); }
    return response({ contributor: { id: 9, displayName: 'Verified volunteer' } });
  } });
  const profile = await client.register('Verified volunteer');
  assert.equal(profile.id, 9);
  assert.deepEqual(bodies, [{ displayName: 'Verified volunteer' }]);
});
