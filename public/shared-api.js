// Translate the shared API contract into the existing map and worksheet views.
export function createSharedApi({ origin, auth, fetchImpl = fetch }) {
  const base = new URL('/api/walk-audits/', origin);
  const drafts = new Map();
  const queues = new Map();
  let profile = null;

  async function request(path, { method = 'GET', body, privateRequest = method !== 'GET' } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (privateRequest) Object.assign(headers, await auth.headers());
    let response;
    try {
      response = await fetchImpl(new URL(path.replace(/^\//, ''), base), {
        method, headers, credentials: 'omit', cache: 'no-store',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch (cause) {
      throw Object.assign(new Error('Connection interrupted. Check whether your change was saved before trying again.'), { isNetworkError: true, cause });
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 409
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
    auditCount: study.auditCount || 0
  });
  const worksheetView = worksheet => ({
    ...worksheet,
    prompts: worksheet.prompts.map(prompt => ({
      ...prompt, type: prompt.type === 'text' ? 'textarea' : 'single-choice',
      optional: !prompt.required,
      options: prompt.options?.map(value => ({ value, label: value }))
    }))
  });
  function auditView(audit, study) {
    const feature = [...(study?.intersections?.features || []), ...(study?.segments?.features || [])]
      .find(item => item.properties.id === audit.featureId);
    return { ...audit, createdBy: audit.createdBy.id, contributorName: audit.createdBy.displayName, geojson: audit.geojson || feature };
  }
  function remember(draft) {
    drafts.set(String(draft.id), structuredClone(draft));
    return { draft };
  }
  function serialize(id, work) {
    const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(id, next);
    void next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
    return next;
  }
  async function getProfile() {
    if (!auth.user()) { profile = null; return null; }
    try { profile = (await request('contributors/me', { privateRequest: true })).contributor; }
    catch (error) { if (error.status !== 404) throw error; profile = null; }
    return userView(profile);
  }
  async function register(displayName) {
    try { profile = (await request('contributors/me', { method: 'POST', body: { displayName } })).contributor; }
    catch (error) {
      if (error.status !== 409) throw error;
      profile = (await request('contributors/me', { privateRequest: true })).contributor;
    }
    return userView(profile);
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
      const studies = await list('studies', 'studies');
      const visible = await Promise.all(studies.map(async study => {
        const audits = await list(`studies/${study.id}/audits`, 'audits');
        if (study.createdBy.id !== profile?.id && !audits.some(audit => audit.createdBy.id === profile?.id)) return null;
        return { ...studyView(study), auditCount: audits.length };
      }));
      return { user: userView(profile), studies: visible.filter(Boolean) };
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
      const audits = summaries.map(audit => auditView(audit, study));
      return {
        study: { ...studyView(study), auditCount: audits.length, lastAudit: audits[0]?.createdOn }, audits, progress,
        permissions: { isOrganizer: study.createdBy.id === profile?.id, canContribute: Boolean(profile) }
      };
    }
    if (route === 'studies' && method === 'POST') {
      const result = await request('studies', { method, body: { neighborhood: body.neighborhood, area: body.area } });
      return { study: studyView(result.study) };
    }
    match = route.match(/^studies\/(\d+)\/drafts$/);
    if (match && method === 'POST') {
      return remember((await request(route, { method, body: body.editingAuditId ? { editingAuditId: body.editingAuditId } : {} })).draft);
    }
    match = route.match(/^drafts\/([^/]+)(\/submit)?$/);
    if (match) {
      const id = match[1];
      if (method === 'GET') return remember((await request(route, { privateRequest: true })).draft);
      return serialize(id, async () => {
        const current = drafts.get(id) || (await request(`drafts/${id}`, { privateRequest: true })).draft;
        if (match[2]) {
          const result = await request(route, { method: 'POST', body: { expectedVersion: current.version } });
          drafts.delete(id);
          return result;
        }
        const updates = { ...body };
        if (Object.hasOwn(updates, 'geojson')) updates.featureId = updates.geojson?.properties?.id || null;
        if (updates.geojson?.geometry?.type === 'Point') {
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
    request: legacy, raw: request, getProfile, register,
    async resumeDraft(studyId, editingAuditId) {
      const items = await list(`studies/${studyId}/drafts`, 'drafts', true);
      const draft = items.find(item => (item.editingAuditId || null) === (editingAuditId || null));
      return draft ? remember(draft).draft : null;
    },
    clear() { profile = null; drafts.clear(); queues.clear(); }
  };
}
