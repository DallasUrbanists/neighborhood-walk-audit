// Reconstruct the geometry omitted by compact audit-list responses. Fractions
// refer to physical length and can run in either direction along an edge.
export function reconstructAuditGeometry(audit, study, segmentIndex) {
  const features = segmentIndex || new Map((study?.segments?.features || []).map(feature => [feature.properties.id, feature]));
  if (audit.type === 'point' && audit.locationGps) {
    return { type: 'Feature', properties: { id: audit.featureId }, geometry: { type: 'Point', coordinates: [audit.locationGps.longitude, audit.locationGps.latitude] } };
  }
  if (audit.type !== 'street-segment' || !audit.routeSelection?.edges) return null;
  const radians = Math.PI / 180;
  const meters = (a, b) => {
    const dy = (b[1] - a[1]) * radians, dx = (b[0] - a[0]) * radians;
    const h = Math.sin(dy / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dx / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  function slice(points, from, to) {
    if (from > to) return slice(points, to, from).reverse();
    const lengths = points.slice(1).map((point, i) => meters(points[i], point));
    const total = lengths.reduce((sum, length) => sum + length, 0), start = total * from, end = total * to;
    const result = []; let walked = 0;
    for (let i = 0; i < lengths.length; i++) {
      const length = lengths[i], segmentEnd = walked + length;
      if (length > 0 && segmentEnd >= start - 1e-8 && walked <= end + 1e-8) {
        const at = distance => {
          const fraction = Math.max(0, Math.min(1, (distance - walked) / length));
          return [points[i][0] + (points[i + 1][0] - points[i][0]) * fraction, points[i][1] + (points[i + 1][1] - points[i][1]) * fraction];
        };
        for (const point of [at(Math.max(start, walked)), at(Math.min(end, segmentEnd))]) {
          if (!result.length || meters(result.at(-1), point) > 0.000001) result.push(point);
        }
      }
      walked = segmentEnd;
    }
    return result;
  }
  const coordinates = [];
  for (const edge of audit.routeSelection.edges) {
    const feature = features.get(edge.featureId);
    if (!feature || feature.geometry?.type !== 'LineString') return null;
    for (const point of slice(feature.geometry.coordinates, edge.fromFraction, edge.toFraction)) {
      if (!coordinates.length || meters(coordinates.at(-1), point) > 0.000001) coordinates.push(point);
    }
  }
  return coordinates.length > 1 ? { type: 'Feature', properties: { id: audit.featureId }, geometry: { type: 'LineString', coordinates } } : null;
}

// Translate the shared API contract into the existing map and worksheet views.
export function createSharedApi({ origin, auth, fetchImpl = fetch }) {
  const base = new URL('/api/walk-audits/', origin);
  const drafts = new Map();
  const queues = new Map();
  const uncertain = new Set();
  const privateUrls = new Set();
  let identityGeneration = 0;
  let profile = null;

  async function request(path, { method = 'GET', body, privateRequest = method !== 'GET', signal } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (privateRequest) Object.assign(headers, await auth.headers());
    let response;
    try {
      response = await fetchImpl(new URL(path.replace(/^\//, ''), base), {
        method, headers, credentials: 'omit', cache: 'no-store', signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch (cause) {
      throw Object.assign(new Error('Connection interrupted. Check whether your change was saved before trying again.'), { isNetworkError: true, cause });
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 409 && data.error === 'VERSION_CONFLICT'
        ? 'This item changed in another tab or session. Your answers are still on this screen. Reload the draft before continuing.'
        : data.message || 'The request could not be completed.';
      throw Object.assign(new Error(message), { status: response.status, code: data.error, retryAfter: response.headers.get('Retry-After') });
    }
    return data;
  }

  async function list(path, key, privateRequest = false) {
    const items = [];
    let offset = 0;
    while (true) {
      const url = new URL(path, base);
      url.searchParams.set('limit', '100');
      url.searchParams.set('offset', String(offset));
      const page = await request(`${url.pathname.slice(base.pathname.length)}${url.search}`, { privateRequest });
      items.push(...page[key]);
      if (!page.hasMore) return items;
      if (!page[key].length) throw new Error('The API returned an invalid empty page.');
      offset += page[key].length;
    }
  }

  const userView = contributor => contributor ? { ...contributor, name: contributor.displayName } : null;
  const studyView = study => ({
    ...study, createdBy: study.createdBy.id, creatorName: study.createdBy.displayName,
    thumbnailPath: new URL(`studies/${study.id}/thumbnail`, base).href,
    auditCount: study.auditCount || 0,
    questionnaires: study.questionnaires && Object.fromEntries(Object.entries(study.questionnaires).map(([type, definition]) => [type, worksheetView({ id: definition.worksheetId, ...definition })]))
  });
  const worksheetView = worksheet => ({
    ...worksheet,
    prompts: worksheet.prompts.map(prompt => ({
      ...prompt, type: prompt.type === 'text' ? 'textarea' : 'single-choice',
      optional: !prompt.required,
      options: prompt.options?.map(value => ({ value, label: value }))
    }))
  });
  function auditView(audit, study, segmentIndex) {
    const feature = audit.type === 'intersection'
      ? (study?.intersections?.features || []).find(item => item.properties.id === audit.featureId)
      : segmentIndex?.get(audit.featureId) || (study?.segments?.features || []).find(item => item.properties.id === audit.featureId);
    const geometry = audit.geojson || reconstructAuditGeometry(audit, study, segmentIndex) || (audit.type === 'point' || audit.routeSelection ? null : feature);
    return { ...audit, createdBy: audit.createdBy.id, contributorName: audit.createdBy.displayName, geojson: geometry, photos: (audit.photos || []).map(photo => ({ ...photo, url: new URL(photo.path, origin).href })) };
  }
  function remember(draft) {
    drafts.set(String(draft.id), structuredClone(draft));
    return { draft };
  }
  function serialize(id, work) {
    const generation = identityGeneration;
    const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      if (generation !== identityGeneration) throw new Error('The signed-in account changed.');
      if (uncertain.has(id)) {
        const refreshed = (await request(`drafts/${id}`, { privateRequest: true })).draft;
        if (generation !== identityGeneration) throw new Error('The signed-in account changed.');
        remember(refreshed);
        uncertain.delete(id);
      }
      try {
        const result = await work();
        if (generation !== identityGeneration) { drafts.delete(id); throw new Error('The signed-in account changed.'); }
        return result;
      } catch (error) {
        if (generation === identityGeneration && error.isNetworkError) uncertain.add(id);
        throw error;
      }
    });
    queues.set(id, next);
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  }
  async function getProfile() {
    const generation = identityGeneration, uid = auth.user()?.uid;
    if (!uid) { profile = null; return null; }
    let result;
    try { result = (await request('contributors/me', { privateRequest: true })).contributor; }
    catch (error) { if (error.status !== 404) throw error; result = null; }
    if (generation !== identityGeneration || auth.user()?.uid !== uid) return null;
    profile = result;
    return userView(profile);
  }
  async function register(displayName) {
    const generation = identityGeneration, uid = auth.user()?.uid;
    let result;
    try { result = (await request('contributors/me', { method: 'POST', body: { displayName } })).contributor; }
    catch (error) {
      if (error.status !== 409) throw error;
      result = (await request('contributors/me', { privateRequest: true })).contributor;
    }
    if (generation !== identityGeneration || auth.user()?.uid !== uid) throw new Error('The signed-in account changed.');
    profile = result;
    return userView(profile);
  }

  async function dashboardPage(group, offset = 0, limit = 12) {
    const generation = identityGeneration;
    const page = await request(`dashboard?group=${encodeURIComponent(group)}&limit=${limit}&offset=${offset}`, { privateRequest: true });
    if (generation !== identityGeneration) throw new Error('The signed-in account changed.');
    return { ...page, studies: page.studies.map(studyView) };
  }

  async function binaryDraftRequest(id, slot, method, blob, signal) {
    return serialize(String(id), async () => {
      const current = drafts.get(String(id)) || (await request(`drafts/${id}`, { privateRequest: true })).draft;
      const headers = { ...(await auth.headers()), 'If-Match': `"${current.version}"`, Accept: 'application/json' };
      if (blob) headers['Content-Type'] = blob.type;
      let response;
      try { response = await fetchImpl(new URL(`drafts/${id}/photos/${slot}`, base), { method, headers, credentials: 'omit', cache: 'no-store', signal, ...(blob ? { body: blob } : {}) }); }
      catch (cause) { throw Object.assign(new Error('Connection interrupted. Check whether your photo was saved before trying again.'), { isNetworkError: true, cause }); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.message || 'The photo could not be saved.'), { status: response.status, code: data.error });
      if (!data.draft) throw Object.assign(new Error('The photo response was incomplete. Refresh the draft before continuing.'), { isNetworkError: true });
      return remember(data.draft);
    });
  }

  async function privatePhoto(id, slot) {
    const generation = identityGeneration;
    const response = await fetchImpl(new URL(`drafts/${id}/photos/${slot}`, base), { headers: await auth.headers(), credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('The private photo preview could not be loaded.');
    const blob = await response.blob();
    if (generation !== identityGeneration) throw new Error('The signed-in account changed.');
    const url = URL.createObjectURL(blob); privateUrls.add(url); return url;
  }

  async function legacy(path, options = {}) {
    const method = options.method || 'GET';
    const url = new URL(path, 'https://legacy.invalid');
    const route = url.pathname.slice('/api/'.length);
    const body = options.body || {};
    if (route === 'session') {
      if (method === 'DELETE') { await auth.signOut(); profile = null; drafts.clear(); return null; }
      return { user: await getProfile() };
    }
    if (route === 'dashboard') {
      if (!profile) await getProfile();
      const [mine, other] = await Promise.all([dashboardPage('mine'), dashboardPage('other')]);
      return { user: userView(profile), studies: mine.studies, otherStudies: other.studies, minePage: mine, otherPage: other };
    }
    if (route === 'worksheets') {
      return { worksheets: (await list(`worksheets${url.search}`, 'worksheets')).map(worksheetView) };
    }
    let match = route.match(/^studies\/(\d+)$/);
    if (match && method === 'GET') {
      const id = match[1];
      const [{ study }, summaries, progress] = await Promise.all([
        request(`studies/${id}`), list(`studies/${id}/audits`, 'audits'), request(`studies/${id}/progress`)
      ]);
      const segmentIndex = new Map((study.segments?.features || []).map(feature => [feature.properties.id, feature]));
      const audits = summaries.map(audit => auditView(audit, study, segmentIndex));
      return {
        study: { ...studyView(study), auditCount: audits.length, lastAudit: audits[0]?.createdOn }, audits, progress,
        permissions: { isOrganizer: study.createdBy.id === profile?.id, canContribute: Boolean(profile) }
      };
    }
    if (route === 'studies' && method === 'POST') {
      const result = await request('studies', { method, body: { neighborhood: body.neighborhood, area: body.area, ...(body.allowedAuditTypes !== undefined ? { allowedAuditTypes: body.allowedAuditTypes, questionnaires: body.questionnaires } : {}) } });
      return { study: studyView(result.study) };
    }
    match = route.match(/^studies\/(\d+)\/drafts$/);
    if (match && method === 'POST') {
      return remember((await request(route, { method, body: body.editingAuditId ? { editingAuditId: body.editingAuditId } : {} })).draft);
    }
    match = route.match(/^drafts\/([^/]+)(\/submit)?$/);
    if (match) {
      const id = match[1];
      if (method === 'GET') {
        const generation = identityGeneration, draft = (await request(route, { privateRequest: true })).draft;
        if (generation !== identityGeneration) throw new Error('The signed-in account changed.');
        return remember(draft);
      }
      return serialize(id, async () => {
        const current = drafts.get(id) || (await request(`drafts/${id}`, { privateRequest: true })).draft;
        if (match[2]) {
          const result = await request(route, { method: 'POST', body: { expectedVersion: current.version } });
          drafts.delete(id);
          return result;
        }
        const updates = { ...body };
        if (Object.hasOwn(updates, 'geojson') && !Object.hasOwn(updates, 'featureId') && !Object.hasOwn(updates, 'routeSelection')) updates.featureId = updates.geojson?.properties?.id || null;
        if (updates.geojson?.geometry?.type === 'Point' && !Object.hasOwn(updates, 'locationGps')) {
          const [longitude, latitude] = updates.geojson.geometry.coordinates;
          updates.locationGps = { longitude, latitude };
        }
        for (const key of Object.keys(updates)) {
          if (JSON.stringify(updates[key]) === JSON.stringify(current[key])) delete updates[key];
        }
        if (!Object.keys(updates).length) return remember(current);
        return remember((await request(route, { method: 'PATCH', body: { ...updates, expectedVersion: current.version } })).draft);
      });
    }
    match = route.match(/^audits\/(\d+)$/);
    if (match) {
      const { audit } = await request(route);
      const [{ study }, { worksheet }] = await Promise.all([request(`studies/${audit.studyId}`), request(`worksheets/${audit.worksheetId}`)]);
      return { audit: { ...auditView(audit, study), worksheetTitle: worksheet.title, worksheetPrompts: worksheetView(worksheet).prompts }, study: studyView(study), permissions: { canEdit: profile?.id === audit.createdBy.id } };
    }
    match = route.match(/^studies\/(\d+)\/reports$/);
    if (match) return method === 'GET' ? { reports: await list(route, 'reports') } : request(route, { method, body });
    throw new Error(`Unsupported application interaction: ${route}`);
  }

  return {
    request: legacy, raw: request, getProfile, register, dashboardPage,
    worksheet: async id => worksheetView((await request(`worksheets/${id}`)).worksheet),
    previewRoute: async (studyId, intent, signal) => (await request(`studies/${studyId}/route-preview`, { method: 'POST', body: intent, signal })).route,
    refreshDraft: id => serialize(String(id), async () => remember((await request(`drafts/${id}`, { privateRequest: true })).draft)),
    putPhoto: (id, slot, blob, signal) => binaryDraftRequest(id, slot, 'PUT', blob, signal),
    deletePhoto: (id, slot) => binaryDraftRequest(id, slot, 'DELETE'),
    privatePhoto,
    revokePhoto(url) { if (privateUrls.delete(url)) URL.revokeObjectURL(url); },
    async resumeDraft(studyId, editingAuditId) {
      const generation = identityGeneration;
      const items = await list(`studies/${studyId}/drafts`, 'drafts', true);
      if (generation !== identityGeneration) throw new Error('The signed-in account changed.');
      const draft = items.find(item => (item.editingAuditId || null) === (editingAuditId || null));
      return draft ? remember(draft).draft : null;
    },
    clear() { identityGeneration++; profile = null; drafts.clear(); queues.clear(); uncertain.clear(); for (const url of privateUrls) URL.revokeObjectURL(url); privateUrls.clear(); }
  };
}
