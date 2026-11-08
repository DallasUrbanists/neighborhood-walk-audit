import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedApi, reconstructAuditGeometry } from '../public/shared-api.js';

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

test('dashboard requests private independent study groups without per-study audit reads', async () => {
  const requests = [];
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (url, options) => {
    requests.push({ path: url.pathname, group: url.searchParams.get('group'), headers: options.headers });
    if (url.pathname.endsWith('/contributors/me')) return response({ contributor: { id: 9, displayName: 'Volunteer' } });
    const id = url.searchParams.get('group') === 'mine' ? 1 : 2;
    return response({ studies: [{ id, neighborhood: `Study ${id}`, createdBy: { id: id === 1 ? 9 : 5, displayName: 'Organizer' }, auditCount: id === 1 ? 2 : 0 }], limit: 12, offset: 0, hasMore: false });
  } });
  const dashboard = await client.request('/api/dashboard');
  assert.equal(dashboard.studies[0].auditCount, 2);
  assert.equal(dashboard.otherStudies[0].auditCount, 0);
  assert.deepEqual(requests.filter(item => item.path.endsWith('/dashboard')).map(item => item.group).sort(), ['mine', 'other']);
  assert.ok(requests.every(item => item.headers.Authorization === 'Bearer refreshed-token'));
  assert.ok(requests.every(item => !item.path.includes('/audits')));
});

test('point and routed summaries reconstruct their own geometry instead of the anchor edge', () => {
  const study = { segments: { features: [
    { type: 'Feature', properties: { id: 'edge-a' }, geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] } },
    { type: 'Feature', properties: { id: 'edge-b' }, geometry: { type: 'LineString', coordinates: [[0.002, 0], [0.001, 0]] } }
  ] } };
  const point = reconstructAuditGeometry({ type: 'point', featureId: 'edge-a', locationGps: { longitude: 0.0005, latitude: 0 } }, study);
  assert.deepEqual(point.geometry, { type: 'Point', coordinates: [0.0005, 0] });
  const route = reconstructAuditGeometry({ type: 'street-segment', featureId: 'edge-a', routeSelection: { edges: [
    { featureId: 'edge-a', fromFraction: 0, toFraction: 1 }, { featureId: 'edge-b', fromFraction: 1, toFraction: 0.5 }
  ] } }, study);
  assert.deepEqual(route.geometry.coordinates[0], [0, 0]);
  assert.deepEqual(route.geometry.coordinates.at(-1), [0.0015, 0]);
  const indexed = new Map(study.segments.features.map(feature => [feature.properties.id, feature]));
  assert.deepEqual(reconstructAuditGeometry({ type: 'street-segment', featureId: 'edge-a', routeSelection: { edges: [{ featureId: 'edge-a', fromFraction: 1, toFraction: 0 }] } }, study, indexed).geometry.coordinates, [[0.001, 0], [0, 0]]);
  assert.equal(reconstructAuditGeometry({ type: 'street-segment', routeSelection: { edges: [{ featureId: 'unknown', fromFraction: 0, toFraction: 1 }] } }, study), null);
});

test('photo and answer writes share the latest version and keep binary bodies intact', async () => {
  let draft = { id: 'draft-a', version: 1, answers: {}, photos: [] }; const writes = [];
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (url, options) => {
    if (options.method === 'GET') return response({ draft });
    if (url.pathname.endsWith('/photos/1')) {
      assert.equal(options.headers['If-Match'], `"${draft.version}"`);
      assert.ok(options.body instanceof Blob); assert.equal(options.headers['Content-Type'], 'image/jpeg');
      writes.push('photo'); draft = { ...draft, version: draft.version + 1, photos: [{ slot: 1 }] };
    } else {
      const body = JSON.parse(options.body); assert.equal(body.expectedVersion, draft.version);
      writes.push('answer'); draft = { ...draft, answers: body.answers, version: draft.version + 1 };
    }
    return response({ draft });
  } });
  await client.request('/api/drafts/draft-a');
  await Promise.all([client.request('/api/drafts/draft-a', { method: 'PATCH', body: { answers: { q: 'new' } } }), client.putPhoto('draft-a', 1, new Blob(['image'], { type: 'image/jpeg' }))]);
  assert.deepEqual(writes, ['answer', 'photo']);
  assert.deepEqual(draft.answers, { q: 'new' }); assert.equal(draft.version, 3);
});

test('refreshes the draft after an unknown mutation outcome and preserves domain conflict messages', async () => {
  let draft = { id: 'draft-a', version: 1, answers: {} }, failOnce = true; const calls = [];
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (url, options) => {
    calls.push(options.method);
    if (url.pathname.endsWith('/conflict')) return response({ error: 'AUDIT_TYPE_IMMUTABLE', message: 'The submitted type is fixed.' }, 409);
    if (options.method === 'GET') return response({ draft });
    const body = JSON.parse(options.body); assert.equal(body.expectedVersion, draft.version);
    draft = { ...draft, answers: body.answers, version: draft.version + 1 };
    if (failOnce) { failOnce = false; throw new Error('response lost'); }
    return response({ draft });
  } });
  await client.request('/api/drafts/draft-a');
  await assert.rejects(client.request('/api/drafts/draft-a', { method: 'PATCH', body: { answers: { q: 'one' } } }), error => error.isNetworkError);
  await client.request('/api/drafts/draft-a', { method: 'PATCH', body: { answers: { q: 'two' } } });
  assert.deepEqual(calls, ['GET', 'PATCH', 'GET', 'PATCH']); assert.equal(draft.version, 3);
  await assert.rejects(client.raw('conflict', { method: 'POST', body: {} }), /submitted type is fixed/);
});

test('a lost photo response can be reconciled and removed using the new version', async () => {
  let draft = { id: 'draft-a', version: 1, answers: {}, photos: [] }; const calls = [];
  const client = createSharedApi({ origin: 'https://api.example.test', auth, fetchImpl: async (url, options) => {
    calls.push(options.method);
    if (options.method === 'GET') return response({ draft });
    assert.equal(options.headers['If-Match'], `"${draft.version}"`);
    if (options.method === 'PUT') { draft = { ...draft, version: 2, photos: [{ id: 'photo-id', slot: 1 }] }; throw new Error('response lost'); }
    draft = { ...draft, version: 3, photos: [] }; return response({ draft });
  } });
  await client.request('/api/drafts/draft-a');
  await assert.rejects(client.putPhoto('draft-a', 1, new Blob(['image'], { type: 'image/jpeg' })), error => error.isNetworkError);
  const refreshed = await client.refreshDraft('draft-a');
  assert.equal(refreshed.draft.photos[0].slot, 1);
  await client.deletePhoto('draft-a', 1);
  assert.equal(draft.photos.length, 0); assert.equal(draft.version, 3);
  assert.ok(calls.slice(2, -1).includes('GET'));
});

test('account changes cannot repopulate the profile from an older private response', async () => {
  let current = { uid: 'first' }, resolveFirst, firstRequested;
  const started = new Promise(resolve => { firstRequested = resolve; });
  const identity = { user: () => current, headers: async () => ({ Authorization: `Bearer ${current.uid}` }), signOut: async () => {} };
  const client = createSharedApi({ origin: 'https://api.example.test', auth: identity, fetchImpl: async (_url, options) => {
    if (options.headers.Authorization === 'Bearer first') { firstRequested(); return new Promise(resolve => { resolveFirst = resolve; }); }
    return response({ contributor: { id: 2, displayName: 'Second' } });
  } });
  const old = client.getProfile(); await started;
  current = { uid: 'second' }; client.clear();
  const next = await client.getProfile();
  resolveFirst(response({ contributor: { id: 1, displayName: 'First' } }));
  assert.equal(await old, null);
  assert.equal(next.name, 'Second');
});
