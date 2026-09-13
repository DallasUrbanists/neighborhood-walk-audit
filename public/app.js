/* global L */
'use strict';

const appRoot = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRegion = document.querySelector('#toast-region');
const themeToggle = document.querySelector('#theme-toggle');
const accountButton = document.querySelector('#account-button');
const brandButton = document.querySelector('#brand-button');
const offlineBanner = document.querySelector('#offline-banner');
const syncStatus = document.querySelector('#sync-status');

const state = {
  user: null,
  config: { demoMode: false, cartoTileVersion: 'default' },
  routeToken: 0,
  activeMaps: [],
  studyWizard: null,
  auditWizard: null,
  currentStudyPayload: null,
  lastPath: null
};

const OUTBOX_KEY = 'walkAuditOutbox:v1';
const THEME_KEY = 'walkAuditTheme:v1';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value, options = {}) {
  if (!value) return 'None yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return 'None yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function monthYear(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(value));
}

function percent(ratio) {
  return `${Math.round((Number(ratio) || 0) * 100)}%`;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function loadingMarkup(message = 'Loading…') {
  return `<section class="loading-screen" aria-live="polite">
    <span class="loader-dot" aria-hidden="true"></span>
    <p>${escapeHtml(message)}</p>
  </section>`;
}

function errorMarkup(message, retry = true) {
  return `<section class="page-shell narrow">
    <div class="panel-card">
      <p class="eyebrow">Something went wrong</p>
      <h1 class="title is-3">We couldn’t open this page.</h1>
      <p class="error-notice">${escapeHtml(message)}</p>
      <div class="button-row mt-5">
        ${retry ? '<button class="button is-primary" id="retry-route" type="button">Try again</button>' : ''}
        <button class="button is-light" id="error-home" type="button">Go to dashboard</button>
      </div>
    </div>
  </section>`;
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
  } catch (error) {
    error.isNetworkError = true;
    throw error;
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.error || data || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  themeToggle.innerHTML = `<span aria-hidden="true">${theme === 'dark' ? '☀' : '☾'}</span>`;
  themeToggle.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#061219' : '#f5c842');
  for (const map of state.activeMaps) replaceTileLayer(map);
}

function initializeTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const preferred = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(stored || preferred);
}

function tileUrl() {
  const style = currentTheme() === 'dark' ? 'dark_all' : 'light_all';
  return `/api/tiles/carto/${style}/{z}/{x}/{y}.png?v=${encodeURIComponent(state.config.cartoTileVersion)}`;
}

function replaceTileLayer(map) {
  if (!map || !window.L) return;
  if (map._walkAuditTileLayer) map.removeLayer(map._walkAuditTileLayer);
  map._walkAuditTileLayer = L.tileLayer(tileUrl(), {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  }).addTo(map);
}

function createMap(elementId, options = {}) {
  const map = L.map(elementId, {
    zoomControl: false,
    attributionControl: true,
    fadeAnimation: false,
    touchZoom: true,
    dragging: true,
    bounceAtZoomLimits: false,
    preferCanvas: true,
    ...options
  });
  replaceTileLayer(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  state.activeMaps.push(map);
  return map;
}

function destroyMaps() {
  for (const map of state.activeMaps) {
    try { map.remove(); } catch (_error) { /* map already removed */ }
  }
  state.activeMaps = [];
}

function boundsFromFeature(feature) {
  try {
    return L.geoJSON(feature).getBounds();
  } catch (_error) {
    return null;
  }
}

function updateHeader() {
  if (state.user) {
    accountButton.hidden = false;
    accountButton.textContent = state.user.name;
    accountButton.dataset.initial = state.user.name.trim().charAt(0).toUpperCase();
    accountButton.title = `${state.user.name} — open dashboard`;
  } else {
    accountButton.hidden = true;
    accountButton.textContent = '';
    delete accountButton.dataset.initial;
  }
}

function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  renderRoute();
}

function safeReturnPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function getOutbox() {
  try {
    const value = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_error) {
    return [];
  }
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setOutbox(items) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  updateConnectionUi();
}

function enqueueRequest(item) {
  const outbox = getOutbox();
  if (item.method === 'PATCH') {
    const existing = outbox.find((candidate) => candidate.method === 'PATCH' && candidate.url === item.url);
    if (existing) {
      existing.body = { ...existing.body, ...item.body };
      existing.createdOn = new Date().toISOString();
      setOutbox(outbox);
      return;
    }
  }
  if (item.method === 'POST' && outbox.some((candidate) => candidate.method === 'POST' && candidate.url === item.url)) return;
  outbox.push({ ...item, id: randomId(), createdOn: new Date().toISOString() });
  setOutbox(outbox);
}

async function flushOutbox() {
  if (!navigator.onLine) return { pending: getOutbox().length };
  let outbox = getOutbox();
  if (!outbox.length) {
    updateConnectionUi();
    return { pending: 0 };
  }
  syncStatus.textContent = 'Syncing…';
  for (const item of [...outbox]) {
    try {
      await api(item.url, { method: item.method, body: item.body });
      outbox = outbox.filter((candidate) => candidate.id !== item.id);
      setOutbox(outbox);
      if (item.meta?.cacheKey && item.method === 'POST') localStorage.removeItem(item.meta.cacheKey);
      if (item.method === 'POST' && item.url.endsWith('/submit')) {
        showToast('Your saved audit has synced.');
        if (location.pathname === `/studies/${item.meta?.studyId}`) renderRoute();
      }
    } catch (error) {
      if (error.isNetworkError || error.status >= 500) break;
      outbox = outbox.filter((candidate) => candidate.id !== item.id);
      setOutbox(outbox);
      showToast(`A saved change could not sync: ${error.message}`, 'error');
    }
  }
  updateConnectionUi();
  return { pending: outbox.length };
}

function updateConnectionUi() {
  offlineBanner.hidden = navigator.onLine;
  const pending = getOutbox().length;
  syncStatus.textContent = !navigator.onLine ? 'Offline' : pending ? `${pending} pending` : '';
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_error) {
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  showToast(successMessage);
}

function pageReady() {
  requestAnimationFrame(() => appRoot.focus({ preventScroll: true }));
}

async function renderRoute() {
  const token = ++state.routeToken;
  destroyMaps();
  modalRoot.replaceChildren();
  state.currentStudyPayload = null;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const pathChanged = state.lastPath !== path;
  state.lastPath = path;
  appRoot.innerHTML = loadingMarkup();

  try {
    if (path === '/' || path === '/login') {
      if (path === '/' && state.user) return renderDashboard(token);
      return renderLogin();
    }
    if (path === '/studies/new') {
      if (!state.user) return navigate(`/login?return=${encodeURIComponent(path)}`, { replace: true });
      if (pathChanged) state.studyWizard = null;
      return renderNewStudy();
    }

    let match = path.match(/^\/studies\/(\d+)\/audits\/(\d+)\/edit$/);
    if (match) {
      if (!state.user) return navigate(`/login?return=${encodeURIComponent(path)}`, { replace: true });
      if (pathChanged) state.auditWizard = null;
      return renderAuditWizard(Number(match[1]), Number(match[2]), token);
    }
    match = path.match(/^\/studies\/(\d+)\/audits\/new$/);
    if (match) {
      if (!state.user) return navigate(`/login?return=${encodeURIComponent(path)}`, { replace: true });
      if (pathChanged) state.auditWizard = null;
      return renderAuditWizard(Number(match[1]), null, token);
    }
    match = path.match(/^\/studies\/(\d+)\/audits\/(\d+)$/);
    if (match) return renderAuditDetail(Number(match[1]), Number(match[2]), token);
    match = path.match(/^\/studies\/(\d+)$/);
    if (match) return renderStudyPage(Number(match[1]), token);

    throw Object.assign(new Error('Page not found.'), { status: 404 });
  } catch (error) {
    if (token !== state.routeToken) return;
    appRoot.innerHTML = errorMarkup(error.message, error.status !== 404);
    document.querySelector('#retry-route')?.addEventListener('click', renderRoute);
    document.querySelector('#error-home')?.addEventListener('click', () => navigate('/'));
    pageReady();
  }
}

initializeTheme();
themeToggle.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
brandButton.addEventListener('click', () => navigate('/'));
accountButton.addEventListener('click', () => navigate('/'));
window.addEventListener('popstate', renderRoute);
window.addEventListener('online', () => { updateConnectionUi(); flushOutbox(); });
window.addEventListener('offline', updateConnectionUi);
updateConnectionUi();

async function unregisterServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in globalThis) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('walk-audit-'))
          .map((cacheName) => caches.delete(cacheName))
      );
    }
  } catch (_error) {
    // Browsers may reject worker inspection or unregistration in development mode.
  }
}

async function boot() {
  try {
    const [config, session] = await Promise.all([api('/api/config'), api('/api/session')]);
    state.config = config;
    state.user = session.user;
    updateHeader();
    await flushOutbox();
  } catch (error) {
    if (!error.isNetworkError) showToast(error.message, 'error');
  }
  renderRoute();
  registerWebMcpTools();

  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocalHost) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  } else {
    unregisterServiceWorkers();
  }
}

boot();

function renderLogin() {
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('return'));
  appRoot.innerHTML = `<section class="login-shell page-shell">
    <div class="panel-card login-panel">
      <p class="eyebrow">Volunteer sign-in</p>
      <h1 class="title">Pick up where your neighborhood left off.</h1>
      <p class="subtitle">Enter your email to organize a study or contribute to one. No password is required in this early version.</p>
      <form id="login-form" novalidate>
        <div class="field">
          <label class="label" for="login-email">Email address</label>
          <div class="control">
            <input class="input" id="login-email" name="email" type="email" inputmode="email" autocomplete="email" required placeholder="you@example.com">
          </div>
          <p class="help">Your email identifies your studies and submissions.</p>
        </div>
        <div id="login-error" class="error-notice mb-4" hidden></div>
        <button class="button is-primary is-fullwidth" type="submit">Continue</button>
      </form>
      ${state.config.demoMode ? `<div class="demo-note mt-5">
        <strong>Preview the sample study</strong><br>
        Use <button class="edit-link p-0" id="sample-login" type="button">organizer@example.com</button> to open a populated organizer dashboard.
      </div>` : ''}
    </div>
  </section>`;

  const form = document.querySelector('#login-form');
  const emailInput = document.querySelector('#login-email');
  document.querySelector('#sample-login')?.addEventListener('click', () => {
    emailInput.value = 'organizer@example.com';
    emailInput.focus();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = document.querySelector('#login-error');
    submit.classList.add('is-loading');
    errorBox.hidden = true;
    try {
      const result = await api('/api/session', { method: 'POST', body: { email: emailInput.value } });
      if (result.needsName) return renderNameStep(result.email, returnTo);
      state.user = result.user;
      updateHeader();
      navigate(returnTo || '/', { replace: true });
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.classList.remove('is-loading');
    }
  });
  pageReady();
  requestAnimationFrame(() => emailInput.focus());
}

function renderNameStep(email, returnTo) {
  appRoot.innerHTML = `<section class="login-shell page-shell">
    <div class="panel-card login-panel">
      <p class="eyebrow">One last detail</p>
      <h1 class="title">What should volunteers call you?</h1>
      <p class="subtitle">This name will appear next to the audits you submit.</p>
      <form id="name-form" novalidate>
        <div class="field">
          <label class="label" for="login-name">Your name</label>
          <input class="input" id="login-name" name="name" autocomplete="name" maxlength="100" required>
        </div>
        <p class="meta-line mb-4">Signing in as ${escapeHtml(email)}</p>
        <div id="name-error" class="error-notice mb-4" hidden></div>
        <div class="button-row">
          <button class="button is-light" id="back-to-email" type="button">Back</button>
          <button class="button is-primary is-expanded" type="submit">Open dashboard</button>
        </div>
      </form>
    </div>
  </section>`;
  document.querySelector('#back-to-email').addEventListener('click', renderLogin);
  const form = document.querySelector('#name-form');
  const input = document.querySelector('#login-name');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = document.querySelector('#name-error');
    submit.classList.add('is-loading');
    errorBox.hidden = true;
    try {
      const result = await api('/api/session', { method: 'POST', body: { email, name: input.value } });
      state.user = result.user;
      updateHeader();
      navigate(returnTo || '/', { replace: true });
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.classList.remove('is-loading');
    }
  });
  pageReady();
  requestAnimationFrame(() => input.focus());
}

async function renderDashboard(token) {
  const { studies } = await api('/api/dashboard');
  if (token !== state.routeToken) return;
  appRoot.innerHTML = `<section class="page-shell">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Your fieldwork</p>
        <h1 class="title is-2">Welcome, ${escapeHtml(state.user.name)}.</h1>
        <p class="subtitle">Studies you organize or contribute to appear here.</p>
      </div>
      <button class="button is-primary" id="start-study" type="button">Start new study</button>
    </div>
    ${studies.length ? `<div class="study-grid">
      ${studies.map((study) => `<article class="study-card">
        <a href="/studies/${study.id}" data-nav>
          <img class="study-thumbnail" src="${escapeHtml(study.thumbnailPath)}" alt="Map thumbnail of the ${escapeHtml(study.neighborhood)} study area">
          <div class="study-card-body">
            <h2 class="study-card-title">${escapeHtml(study.neighborhood)} ${escapeHtml(monthYear(study.createdOn))}</h2>
            <p class="study-card-meta">${study.auditCount} ${study.auditCount === 1 ? 'audit' : 'audits'} · Started ${escapeHtml(formatDate(study.createdOn))}</p>
          </div>
        </a>
      </article>`).join('')}
    </div>` : `<div class="empty-state">
      <h2 class="title">No studies yet</h2>
      <p class="mb-4">Draw a neighborhood boundary, then invite volunteers to audit its streets and intersections.</p>
      <button class="button is-primary" id="empty-start-study" type="button">Start your first study</button>
    </div>`}
    <div class="mt-6">
      <button class="button is-light" id="sign-out" type="button">Sign out</button>
    </div>
  </section>`;

  document.querySelectorAll('[data-nav]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(link.getAttribute('href'));
  }));
  document.querySelector('#start-study')?.addEventListener('click', () => navigate('/studies/new'));
  document.querySelector('#empty-start-study')?.addEventListener('click', () => navigate('/studies/new'));
  document.querySelector('#sign-out').addEventListener('click', async () => {
    await api('/api/session', { method: 'DELETE' });
    state.user = null;
    updateHeader();
    navigate('/login', { replace: true });
  });
  pageReady();
}

function studyWizardFrame({ step, title, help, content, mapStep = false }) {
  return `<section class="wizard-shell ${mapStep ? 'is-map-step' : ''}">
    <div class="wizard-topline">
      <p class="eyebrow mb-0">New study</p>
      <span class="step-label">Step ${step} of 2</span>
    </div>
    <div class="progress-track" aria-label="Study setup progress"><div class="progress-fill" style="width:${step * 50}%"></div></div>
    <h1 class="wizard-question">${escapeHtml(title)}</h1>
    ${help ? `<p class="wizard-help">${escapeHtml(help)}</p>` : ''}
    ${content}
  </section>`;
}

function renderNewStudy() {
  if (!state.studyWizard) {
    state.studyWizard = { step: 1, neighborhood: '', vertices: [], error: null };
  }
  const wizard = state.studyWizard;
  destroyMaps();
  if (wizard.step === 1) {
    appRoot.innerHTML = studyWizardFrame({
      step: 1,
      title: 'Which neighborhood are you auditing?',
      help: 'Use the name volunteers will recognize in shared links and reports.',
      content: `<form id="neighborhood-form">
        <div class="field">
          <label class="label" for="neighborhood-name">Neighborhood name</label>
          <input class="input" id="neighborhood-name" maxlength="160" autocomplete="off" value="${escapeHtml(wizard.neighborhood)}" placeholder="For example, The Cedars" required>
        </div>
        <div id="study-step-error" class="error-notice" ${wizard.error ? '' : 'hidden'}>${escapeHtml(wizard.error || '')}</div>
        <div class="wizard-actions">
          <button class="button is-light" id="cancel-study" type="button">Cancel</button>
          <button class="button is-primary" type="submit">Next</button>
        </div>
      </form>`
    });
    document.querySelector('#cancel-study').addEventListener('click', () => navigate('/'));
    const form = document.querySelector('#neighborhood-form');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = document.querySelector('#neighborhood-name').value.trim().replace(/\s+/g, ' ');
      if (!name) {
        wizard.error = 'Enter a neighborhood name.';
        return renderNewStudy();
      }
      wizard.neighborhood = name;
      wizard.error = null;
      wizard.step = 2;
      renderNewStudy();
    });
    pageReady();
    requestAnimationFrame(() => document.querySelector('#neighborhood-name')?.focus());
    return;
  }

  appRoot.innerHTML = studyWizardFrame({
    step: 2,
    title: `Draw the ${wizard.neighborhood} study area`,
    help: 'Move and zoom the map. Place the crosshair at each corner, then tap Add corner. You can drag any corner afterward.',
    mapStep: true,
    content: `<div class="map-shell boundary-map-shell">
      <div id="boundary-map" class="map-canvas" role="region" aria-label="Map for drawing the study boundary"></div>
      <div class="map-crosshair" aria-hidden="true"></div>
      <div class="map-instruction" id="boundary-count">No corners yet</div>
      <div class="map-overlay-controls">
        <button class="map-control-button" id="boundary-locate" type="button" aria-label="Center map on my location" title="My location">◎</button>
      </div>
    </div>
    <div class="map-action-tray" aria-label="Boundary drawing controls">
      <button class="button is-light" id="boundary-back" type="button">Back</button>
      <button class="button is-light" id="boundary-undo" type="button">Undo</button>
      <button class="button is-light" id="boundary-clear" type="button">Clear</button>
      <button class="button is-link" id="boundary-add" type="button">＋ Add corner</button>
      <button class="button is-primary" id="boundary-finish" type="button" disabled>Finished drawing</button>
    </div>
    <div id="boundary-error" class="error-notice mt-3" ${wizard.error ? '' : 'hidden'}>${escapeHtml(wizard.error || '')}</div>`
  });
  initializeBoundaryMap();
  pageReady();
}

function locateMap(map, onSuccess) {
  if (!navigator.geolocation) {
    showToast('Location services are not available in this browser.', 'error');
    return;
  }
  const button = document.activeElement;
  button?.classList?.add('is-loading');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      button?.classList?.remove('is-loading');
      const latlng = [position.coords.latitude, position.coords.longitude];
      map.setView(latlng, Math.max(map.getZoom(), 17));
      onSuccess?.(position);
    },
    (error) => {
      button?.classList?.remove('is-loading');
      showToast(error.code === 1 ? 'Location permission was not granted.' : 'Your location could not be determined.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }
  );
}

function initializeBoundaryMap() {
  const wizard = state.studyWizard;
  const map = createMap('boundary-map', { scrollWheelZoom: true });
  const fallback = [32.7767, -96.797];
  if (wizard.vertices.length) {
    map.fitBounds(L.latLngBounds(wizard.vertices.map(([lng, lat]) => [lat, lng])), { padding: [60, 60], maxZoom: 17 });
  } else {
    map.setView(fallback, 13);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => map.setView([position.coords.latitude, position.coords.longitude], 15),
        () => {},
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 }
      );
    }
  }

  let polygonLayer;
  let markers = [];
  const vertexIcon = L.divIcon({ className: '', html: '<span class="vertex-marker"></span>', iconSize: [32, 32], iconAnchor: [16, 16] });

  function redraw() {
    if (polygonLayer) map.removeLayer(polygonLayer);
    for (const marker of markers) map.removeLayer(marker);
    markers = [];
    const latlngs = wizard.vertices.map(([lng, lat]) => [lat, lng]);
    if (latlngs.length >= 2) {
      polygonLayer = (latlngs.length >= 3
        ? L.polygon(latlngs, { color: '#087c74', weight: 5, fillColor: '#f5c842', fillOpacity: 0.28 })
        : L.polyline(latlngs, { color: '#087c74', weight: 5 }))
        .addTo(map);
    }
    wizard.vertices.forEach((coordinate, index) => {
      const marker = L.marker([coordinate[1], coordinate[0]], { draggable: true, icon: vertexIcon, keyboard: true }).addTo(map);
      marker.on('drag', (event) => {
        const latlng = event.target.getLatLng();
        wizard.vertices[index] = [latlng.lng, latlng.lat];
        if (polygonLayer) polygonLayer.setLatLngs(wizard.vertices.map(([lng, lat]) => [lat, lng]));
      });
      markers.push(marker);
    });
    const count = wizard.vertices.length;
    document.querySelector('#boundary-count').textContent = count
      ? `${count} ${count === 1 ? 'corner' : 'corners'} placed${count < 3 ? ` · ${3 - count} more needed` : ' · ready to finish'}`
      : 'No corners yet · add at least 3';
    document.querySelector('#boundary-undo').disabled = count === 0;
    document.querySelector('#boundary-clear').disabled = count === 0;
    document.querySelector('#boundary-finish').disabled = count < 3;
  }

  document.querySelector('#boundary-locate').addEventListener('click', () => locateMap(map));
  document.querySelector('#boundary-add').addEventListener('click', () => {
    const center = map.getCenter();
    wizard.vertices.push([center.lng, center.lat]);
    redraw();
    if (navigator.vibrate) navigator.vibrate(25);
  });
  document.querySelector('#boundary-undo').addEventListener('click', () => {
    wizard.vertices.pop();
    redraw();
  });
  document.querySelector('#boundary-clear').addEventListener('click', () => {
    wizard.vertices = [];
    redraw();
  });
  document.querySelector('#boundary-back').addEventListener('click', () => {
    wizard.step = 1;
    renderNewStudy();
  });
  document.querySelector('#boundary-finish').addEventListener('click', createStudyFromWizard);
  redraw();
  requestAnimationFrame(() => map.invalidateSize());
}

function openStudyLoadingModal() {
  modalRoot.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="loading-title">
    <div class="modal-card-custom" tabindex="-1">
      <span class="loader-dot" aria-hidden="true"></span>
      <h2 class="title is-3 mt-4" id="loading-title">Building your study map</h2>
      <p>This can take a minute while OpenStreetMap identifies every auditable street and intersection.</p>
      <div class="loading-phases" aria-live="polite">
        <div class="loading-phase is-active"><span class="phase-indicator"></span><span>Saving the study boundary</span></div>
        <div class="loading-phase"><span class="phase-indicator"></span><span>Finding streets and intersections</span></div>
        <div class="loading-phase"><span class="phase-indicator"></span><span>Drawing the study thumbnail</span></div>
      </div>
    </div>
  </div>`;
  modalRoot.querySelector('.modal-card-custom').focus();
  const phases = [...modalRoot.querySelectorAll('.loading-phase')];
  let active = 0;
  const timer = setInterval(() => {
    phases[active]?.classList.remove('is-active');
    active = Math.min(active + 1, phases.length - 1);
    phases[active]?.classList.add('is-active');
  }, 2400);
  return () => {
    clearInterval(timer);
    modalRoot.replaceChildren();
  };
}

async function createStudyFromWizard() {
  const wizard = state.studyWizard;
  if (wizard.vertices.length < 3) return;
  const coordinates = [...wizard.vertices, wizard.vertices[0]];
  const area = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } };
  const closeModal = openStudyLoadingModal();
  try {
    const result = await api('/api/studies', {
      method: 'POST',
      body: { neighborhood: wizard.neighborhood, area }
    });
    closeModal();
    state.studyWizard = null;
    navigate(`/studies/${result.study.id}?created=1`, { replace: true });
  } catch (error) {
    closeModal();
    wizard.error = error.message;
    const errorBox = document.querySelector('#boundary-error');
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function confirmationFromQuery() {
  const query = new URLSearchParams(location.search);
  if (query.get('created') === '1') return 'New study created! Copy the link to invite volunteers.';
  if (query.get('submitted') === '1') return 'Thank you for your walk audit! Your submission has been saved.';
  if (query.get('saved') === '1') return 'Your walk audit changes have been saved.';
  if (query.get('pending') === '1') return 'Your audit is saved on this phone and will submit automatically when you’re back online.';
  return null;
}

async function renderStudyPage(studyId, token) {
  const [payload, reportPayload] = await Promise.all([
    api(`/api/studies/${studyId}`),
    api(`/api/studies/${studyId}/reports`)
  ]);
  if (token !== state.routeToken) return;
  const { study, audits, progress, permissions } = payload;
  state.currentStudyPayload = payload;
  const reports = reportPayload.reports;
  const confirmation = confirmationFromQuery();
  appRoot.innerHTML = `<section class="page-shell">
    ${confirmation ? `<div class="${new URLSearchParams(location.search).get('pending') === '1' ? 'notice' : 'success-notice'} mb-4" role="status">${escapeHtml(confirmation)}</div>` : ''}
    <div class="study-hero">
      <div>
        <p class="eyebrow">Neighborhood study</p>
        <h1 class="title">${escapeHtml(study.neighborhood)}</h1>
        <div class="study-meta">
          <span>Started ${escapeHtml(formatDate(study.createdOn))}</span>
          <span>Last audit ${escapeHtml(study.lastAudit ? formatDate(study.lastAudit) : 'none yet')}</span>
          <span>Organized by ${escapeHtml(study.creatorName || 'a volunteer')}</span>
        </div>
      </div>
      <div class="study-hero-actions">
        <button class="button is-primary" id="submit-audit" type="button">Submit an audit</button>
      </div>
    </div>

    <div class="study-layout">
      <div>
        <div class="panel-card">
          <div class="section-heading">
            <h2 class="title is-4">Study map</h2>
            <button class="button is-light" id="copy-study-link" type="button">Copy study link</button>
          </div>
          <div class="map-shell study-map-shell">
            <div id="study-map" class="map-canvas" role="region" aria-label="Map of the study area and completed audits"></div>
          </div>
          <p class="help mt-3">Yellow marks the study area. Completed street segments and intersections are green. Tap a completed location for details.</p>
        </div>
      </div>

      <aside class="study-sidebar">
        <section class="panel-card">
          <div class="section-heading"><h2 class="title is-4">Audit progress</h2></div>
          ${progressMarkup('Streets', progress.streets)}
          ${progressMarkup('Intersections', progress.intersections)}
        </section>
        <section class="panel-card">
          <div class="section-heading">
            <h2 class="title is-4">Reports</h2>
          </div>
          <p class="help mb-4">Each report is a snapshot of all audits submitted at that time.</p>
          ${permissions.isOrganizer ? '<button class="button is-link is-fullwidth mb-4" id="generate-report" type="button">Generate current report</button>' : ''}
          <div id="report-list" class="report-list">
            ${reports.length ? reports.map(reportMarkup).join('') : '<p class="meta-line">No reports generated yet.</p>'}
          </div>
        </section>
      </aside>
    </div>

    <section class="audit-history">
      <div class="section-heading">
        <h2 class="title is-4">Audit history</h2>
        <span class="meta-line">${audits.length} ${audits.length === 1 ? 'submission' : 'submissions'}</span>
      </div>
      ${audits.length ? `<div class="audit-table-wrap">
        <table class="table audit-table is-fullwidth">
          <thead><tr><th>Timestamp</th><th>Description</th><th>Contributor</th></tr></thead>
          <tbody>${audits.map((audit) => `<tr data-audit-id="${audit.id}" tabindex="0" aria-label="View audit: ${escapeHtml(audit.locationDescription)}">
            <td>${escapeHtml(formatDateTime(audit.createdOn))}</td>
            <td><strong>${escapeHtml(audit.locationDescription)}</strong></td>
            <td>${escapeHtml(audit.contributorName)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="audit-cards-mobile">${audits.map((audit) => `<article class="audit-card" data-audit-id="${audit.id}" tabindex="0" role="link">
        <p class="audit-card-title">${escapeHtml(audit.locationDescription)}</p>
        <p class="audit-card-meta">${escapeHtml(formatDateTime(audit.createdOn))} · ${escapeHtml(audit.contributorName)}</p>
      </article>`).join('')}</div>` : `<div class="empty-state">
        <h3 class="title">No audits submitted yet</h3>
        <p>This map is ready for the first volunteer observation.</p>
      </div>`}
    </section>
  </section>`;

  document.querySelector('#submit-audit').addEventListener('click', () => {
    const target = `/studies/${study.id}/audits/new`;
    navigate(state.user ? target : `/login?return=${encodeURIComponent(target)}`);
  });
  document.querySelector('#copy-study-link').addEventListener('click', () => {
    copyText(`${location.origin}/studies/${study.id}`, 'Study link copied.');
  });
  document.querySelectorAll('[data-audit-id]').forEach((row) => {
    const open = () => navigate(`/studies/${study.id}/audits/${row.dataset.auditId}`);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
  });
  document.querySelector('#generate-report')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    try {
      const result = await api(`/api/studies/${study.id}/reports`, { method: 'POST', body: {} });
      const list = document.querySelector('#report-list');
      if (list.querySelector('.meta-line')) list.replaceChildren();
      list.insertAdjacentHTML('afterbegin', reportMarkup(result.report));
      showToast('A new report snapshot was generated.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.classList.remove('is-loading');
    }
  });

  initializeStudyMap(study, audits);
  pageReady();
}

function progressMarkup(label, item) {
  return `<div class="progress-stat">
    <div class="progress-stat-header">
      <span class="progress-stat-label">${escapeHtml(label)}</span>
      <span class="progress-stat-value">${percent(item.ratio)}</span>
    </div>
    <div class="progress-track" role="progressbar" aria-label="${escapeHtml(label)} audited" aria-valuenow="${Math.round(item.ratio * 100)}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-fill" style="width:${Math.round(item.ratio * 100)}%"></div>
    </div>
    <p class="progress-caption">${item.audited} of ${item.total} mapped</p>
  </div>`;
}

function reportMarkup(report) {
  return `<article class="report-card">
    <p class="review-label">${escapeHtml(formatDateTime(report.createdOn))} · ${percent(report.completion)} complete</p>
    <p class="mt-2">${escapeHtml(report.description)}</p>
  </article>`;
}

function initializeStudyMap(study, audits) {
  const map = createMap('study-map', { scrollWheelZoom: false });
  const areaLayer = L.geoJSON(study.area, {
    style: { color: '#9a7700', weight: 4, fillColor: '#f5c842', fillOpacity: 0.23 }
  }).addTo(map);

  L.geoJSON(study.segments, {
    style: { color: currentTheme() === 'dark' ? '#8ba2a7' : '#64787d', weight: 1, opacity: 0.25 }
  }).addTo(map);
  /*L.geoJSON(study.intersections, {
    pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
      radius: 2, color: '#64787d', weight: 2, fillColor: '#ffffff', fillOpacity: 0, opacity: 0.25
    })
  }).addTo(map);*/

  const latestByFeature = new Map();
  for (const audit of audits) {
    const id = audit.geojson?.properties?.id || `audit-${audit.id}`;
    if (!latestByFeature.has(id)) latestByFeature.set(id, audit);
  }
  for (const audit of latestByFeature.values()) {
    const layer = L.geoJSON(audit.geojson, {
      style: { color: '#087447', weight: 8, opacity: 0.95 },
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
        radius: 1, color: '#087447', weight: 1, fillColor: '#ffffff', fillOpacity: 1
      })
    }).addTo(map);
    layer.bindPopup(`<strong>${escapeHtml(audit.locationDescription)}</strong><br>
      ${escapeHtml(audit.contributorName)} · ${escapeHtml(formatDateTime(audit.createdOn))}<br>
      <a href="/studies/${study.id}/audits/${audit.id}" class="map-audit-link">View full audit</a>`);
  }
  map.on('popupopen', () => {
    document.querySelectorAll('.map-audit-link').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.getAttribute('href'));
    }));
  });

  const bounds = areaLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
  requestAnimationFrame(() => map.invalidateSize());
}

function auditCacheKey(studyId, editingAuditId) {
  return `walkAuditDraft:v1:${state.user?.id || 'guest'}:${studyId}:${editingAuditId || 'new'}`;
}

function readAuditCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (_error) {
    return null;
  }
}

function writeAuditCache() {
  const wizard = state.auditWizard;
  if (!wizard) return;
  localStorage.setItem(wizard.cacheKey, JSON.stringify({
    draftId: wizard.draft.id,
    draft: wizard.draft,
    step: wizard.step,
    questionIndex: wizard.questionIndex,
    savedOn: new Date().toISOString()
  }));
}

async function renderAuditWizard(studyId, editingAuditId, token) {
  if (!state.auditWizard || state.auditWizard.studyId !== studyId || state.auditWizard.editingAuditId !== editingAuditId) {
    const cacheKey = auditCacheKey(studyId, editingAuditId);
    const cached = readAuditCache(cacheKey);
    const studyPayload = await api(`/api/studies/${studyId}`);
    if (token !== state.routeToken) return;
    let draft = null;
    if (cached?.draftId) {
      if (navigator.onLine) {
        try {
          draft = (await api(`/api/drafts/${cached.draftId}`)).draft;
        } catch (error) {
          if (error.status !== 404) throw error;
          localStorage.removeItem(cacheKey);
        }
      } else {
        draft = cached.draft;
      }
    }
    if (!draft) {
      if (!navigator.onLine) throw new Error('Reconnect once to start this audit. After it starts, every answer can be saved offline.');
      draft = (await api(`/api/studies/${studyId}/drafts`, {
        method: 'POST',
        body: { editingAuditId }
      })).draft;
    }
    state.auditWizard = {
      studyId,
      editingAuditId,
      study: studyPayload.study,
      draft,
      cacheKey,
      step: Math.min(Math.max(Number(cached?.step || 1), 1), 6),
      questionIndex: Math.max(Number(cached?.questionIndex || 0), 0),
      worksheets: null,
      selectedFeature: draft.geojson || null,
      locationMarker: null,
      locationAccuracy: null
    };
    writeAuditCache();
  }
  await renderAuditWizardScreen();
}

function auditWizardFrame({ title, help, content, step, mapStep = false }) {
  const wizard = state.auditWizard;
  const label = wizard.editingAuditId ? 'Edit audit' : 'New walk audit';
  return `<section class="wizard-shell ${mapStep ? 'is-map-step' : ''}">
    <div class="wizard-topline">
      <p class="eyebrow mb-0">${label} · ${escapeHtml(wizard.study.neighborhood)}</p>
      <span class="step-label">Step ${step} of 6</span>
    </div>
    <div class="progress-track" aria-label="Audit progress"><div class="progress-fill" style="width:${(step / 6) * 100}%"></div></div>
    <h1 class="wizard-question">${escapeHtml(title)}</h1>
    ${help ? `<p class="wizard-help">${escapeHtml(help)}</p>` : ''}
    ${content}
  </section>`;
}

async function renderAuditWizardScreen() {
  const wizard = state.auditWizard;
  destroyMaps();
  writeAuditCache();
  if (wizard.step === 1) return renderAuditTypeStep();
  if (wizard.step === 2) return renderAuditLocationStep();
  if (wizard.step === 3) return renderAuditDescriptionStep();
  if (wizard.step === 4) return renderWorksheetStep();
  if (wizard.step === 5) return renderQuestionStep();
  return renderAuditReviewStep();
}

async function persistAuditDraft(updates) {
  const wizard = state.auditWizard;
  Object.assign(wizard.draft, structuredClone(updates));
  writeAuditCache();
  const request = { method: 'PATCH', url: `/api/drafts/${wizard.draft.id}`, body: updates };
  if (!navigator.onLine) {
    enqueueRequest(request);
    syncStatus.textContent = 'Saved on phone';
    return wizard.draft;
  }
  syncStatus.textContent = 'Saving…';
  try {
    const result = await api(request.url, { method: request.method, body: request.body });
    wizard.draft = result.draft;
    writeAuditCache();
    syncStatus.textContent = 'Saved';
    setTimeout(updateConnectionUi, 1400);
    return result.draft;
  } catch (error) {
    if (error.isNetworkError || error.status >= 500) {
      enqueueRequest(request);
      syncStatus.textContent = 'Saved on phone';
      return wizard.draft;
    }
    syncStatus.textContent = '';
    throw error;
  }
}

function renderAuditTypeStep() {
  const wizard = state.auditWizard;
  appRoot.innerHTML = auditWizardFrame({
    step: 1,
    title: 'What are you auditing?',
    help: 'Choose the kind of mapped location your observation describes.',
    content: `<div class="choice-grid" role="radiogroup" aria-label="Audit type">
      <label class="choice-card ${wizard.draft.type === 'intersection' ? 'is-selected' : ''}">
        <input type="radio" name="audit-type" value="intersection" ${wizard.draft.type === 'intersection' ? 'checked' : ''}>
        <span class="choice-icon" aria-hidden="true">＋</span>
        <span>
          <span class="choice-title">Intersection</span>
          <span class="choice-description">A crossing where two or more streets meet.</span>
        </span>
      </label>
      <label class="choice-card ${wizard.draft.type === 'street-segment' ? 'is-selected' : ''}">
        <input type="radio" name="audit-type" value="street-segment" ${wizard.draft.type === 'street-segment' ? 'checked' : ''}>
        <span class="choice-icon" aria-hidden="true">━</span>
        <span>
          <span class="choice-title">Street segment</span>
          <span class="choice-description">The length of a street between two intersections.</span>
        </span>
      </label>
    </div>
    <div id="audit-step-error" class="error-notice mt-4" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="audit-cancel" type="button">Back to study</button>
      <button class="button is-primary" id="type-next" type="button" ${wizard.draft.type ? '' : 'disabled'}>Next</button>
    </div>`
  });

  document.querySelectorAll('input[name="audit-type"]').forEach((input) => input.addEventListener('change', () => {
    const changed = wizard.draft.type && wizard.draft.type !== input.value;
    wizard.draft.type = input.value;
    if (changed) Object.assign(wizard.draft, {
      worksheetId: null, locationGps: null, locationDescription: null, geojson: null, answers: {}
    });
    document.querySelectorAll('.choice-card').forEach((card) => card.classList.toggle('is-selected', card.contains(input)));
    document.querySelector('#type-next').disabled = false;
    writeAuditCache();
  }));
  document.querySelector('#audit-cancel').addEventListener('click', () => navigate(`/studies/${wizard.studyId}`));
  document.querySelector('#type-next').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    try {
      await persistAuditDraft({
        type: wizard.draft.type,
        worksheetId: wizard.draft.worksheetId,
        locationGps: wizard.draft.locationGps,
        locationDescription: wizard.draft.locationDescription,
        geojson: wizard.draft.geojson,
        answers: wizard.draft.answers
      });
      wizard.step = 2;
      renderAuditWizardScreen();
    } catch (error) {
      const errorBox = document.querySelector('#audit-step-error');
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.classList.remove('is-loading');
    }
  });
  pageReady();
}

function areaCenter(area) {
  const ring = area?.geometry?.coordinates?.[0] || [];
  if (!ring.length) return [32.7767, -96.797];
  const points = ring.slice(0, -1);
  const longitude = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const latitude = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [latitude, longitude];
}

function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const lat1 = a[0] * radians;
  const lat2 = b[0] * radians;
  const dLat = (b[0] - a[0]) * radians;
  const dLon = (b[1] - a[1]) * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function nearestPointOnSegment(target, a, b) {
  const cos = Math.cos((target[0] * Math.PI) / 180);
  const tx = target[1] * cos;
  const ty = target[0];
  const ax = a[1] * cos;
  const ay = a[0];
  const bx = b[1] * cos;
  const by = b[0];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared ? Math.max(0, Math.min(1, ((tx - ax) * dx + (ty - ay) * dy) / lengthSquared)) : 0;
  return [ay + amount * dy, (ax + amount * dx) / cos];
}

function nearestStudyFeature(study, type, latlng) {
  const features = type === 'intersection' ? study.intersections.features : study.segments.features;
  let best = null;
  for (const feature of features) {
    let candidate;
    if (feature.geometry.type === 'Point') {
      candidate = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
    } else {
      const coordinates = feature.geometry.coordinates;
      for (let index = 1; index < coordinates.length; index += 1) {
        const pointOnLine = nearestPointOnSegment(
          latlng,
          [coordinates[index - 1][1], coordinates[index - 1][0]],
          [coordinates[index][1], coordinates[index][0]]
        );
        const segmentDistance = distanceMeters(latlng, pointOnLine);
        if (!candidate || segmentDistance < candidate.distance) candidate = { latlng: pointOnLine, distance: segmentDistance };
      }
      candidate = candidate?.latlng;
    }
    if (!candidate) continue;
    const distance = distanceMeters(latlng, candidate);
    if (!best || distance < best.distance) best = { feature, latlng: candidate, distance };
  }
  return best;
}

function renderAuditLocationStep() {
  const wizard = state.auditWizard;
  const typeLabel = wizard.draft.type === 'intersection' ? 'intersection' : 'street segment';
  appRoot.innerHTML = auditWizardFrame({
    step: 2,
    title: `Pin the ${typeLabel}`,
    help: 'We’ll start with your phone’s location. Drag the map pin if needed; the closest mapped location will highlight in red.',
    mapStep: true,
    content: `<div class="map-shell audit-map-shell">
      <div id="audit-location-map" class="map-canvas" role="region" aria-label="Map for selecting the audit location"></div>
      <div class="map-overlay-controls">
        <button class="map-control-button" id="audit-locate" type="button" aria-label="Use my current location" title="My location">◎</button>
      </div>
    </div>
    <div class="location-readout" aria-live="polite">
      <span class="location-dot" aria-hidden="true"></span>
      <div><strong id="snapped-description">Finding the nearest ${typeLabel}…</strong><p class="help" id="snapped-distance"></p></div>
    </div>
    <div id="audit-location-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="location-back" type="button">Back</button>
      <button class="button is-primary" id="location-next" type="button" disabled>Next</button>
    </div>`
  });
  initializeAuditLocationMap();
  document.querySelector('#location-back').addEventListener('click', () => {
    wizard.step = 1;
    renderAuditWizardScreen();
  });
  document.querySelector('#location-next').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    try {
      await persistAuditDraft({
        locationGps: wizard.draft.locationGps,
        locationDescription: wizard.draft.locationDescription,
        geojson: wizard.selectedFeature
      });
      wizard.step = 3;
      renderAuditWizardScreen();
    } catch (error) {
      const errorBox = document.querySelector('#audit-location-error');
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.classList.remove('is-loading');
    }
  });
  pageReady();
}

function initializeAuditLocationMap() {
  const wizard = state.auditWizard;
  const map = createMap('audit-location-map', { scrollWheelZoom: true });
  const center = wizard.draft.locationGps
    ? [wizard.draft.locationGps.latitude, wizard.draft.locationGps.longitude]
    : areaCenter(wizard.study.area);
  map.setView(center, wizard.draft.locationGps ? 18 : 16);
  const areaLayer = L.geoJSON(wizard.study.area, {
    style: { color: '#9a7700', weight: 3, fillColor: '#f5c842', fillOpacity: 0.16 }
  }).addTo(map);
  if (!wizard.draft.locationGps) {
    const bounds = areaLayer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
  }

  const marker = L.marker(center, { draggable: true, keyboard: true, title: 'Audit location pin' }).addTo(map);
  wizard.locationMarker = marker;
  let highlighted;
  let accuracyCircle;

  function updateSelection(latlng) {
    if (highlighted) map.removeLayer(highlighted);
    const match = nearestStudyFeature(wizard.study, wizard.draft.type, [latlng.lat, latlng.lng]);
    if (!match) {
      document.querySelector('#snapped-description').textContent = `No mapped ${wizard.draft.type === 'intersection' ? 'intersection' : 'street segment'} found.`;
      document.querySelector('#location-next').disabled = true;
      return;
    }
    wizard.selectedFeature = structuredClone(match.feature);
    wizard.draft.geojson = structuredClone(match.feature);
    wizard.draft.locationGps = { latitude: latlng.lat, longitude: latlng.lng };
    wizard.draft.locationDescription = match.feature.properties?.description
      || (wizard.draft.type === 'intersection' ? 'Selected intersection' : 'Selected street segment');
    highlighted = L.geoJSON(match.feature, {
      style: { color: '#d3263e', weight: 9, opacity: 1 },
      pointToLayer: (_feature, pointLatLng) => L.circleMarker(pointLatLng, {
        radius: 13, color: '#ffffff', weight: 4, fillColor: '#d3263e', fillOpacity: 1
      })
    }).addTo(map);
    highlighted.bringToFront?.();
    marker.setZIndexOffset(1000);
    document.querySelector('#snapped-description').textContent = wizard.draft.locationDescription;
    document.querySelector('#snapped-distance').textContent = match.distance > 250
      ? `Nearest mapped location is ${Math.round(match.distance)} m away. Move the pin into the study area if this is not correct.`
      : `${Math.round(match.distance)} m from the pin`;
    document.querySelector('#location-next').disabled = false;
    writeAuditCache();
  }

  marker.on('dragend', (event) => updateSelection(event.target.getLatLng()));
  marker.on('drag', (event) => {
    const latlng = event.target.getLatLng();
    wizard.draft.locationGps = { latitude: latlng.lat, longitude: latlng.lng };
  });
  updateSelection(marker.getLatLng());

  function usePosition(position) {
    const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
    marker.setLatLng(latlng);
    map.setView(latlng, 18);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    accuracyCircle = L.circle(latlng, {
      radius: Math.min(position.coords.accuracy, 200),
      color: '#147ca0', weight: 2, fillColor: '#52bde0', fillOpacity: 0.15, interactive: false
    }).addTo(map);
    updateSelection(latlng);
  }

  document.querySelector('#audit-locate').addEventListener('click', () => locateMap(map, usePosition));
  if (!wizard.draft.locationGps && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(usePosition, () => {}, {
      enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000
    });
  }
  requestAnimationFrame(() => map.invalidateSize());
}

function renderAuditDescriptionStep() {
  const wizard = state.auditWizard;
  appRoot.innerHTML = auditWizardFrame({
    step: 3,
    title: 'Confirm the location description',
    help: 'We filled this in from the mapped street names. Edit it if local knowledge can make it clearer.',
    content: `<div class="field">
      <label class="label" for="location-description">Location description</label>
      <textarea class="textarea" id="location-description" maxlength="500" rows="3">${escapeHtml(wizard.draft.locationDescription || '')}</textarea>
      <p class="help"><span id="description-count">${(wizard.draft.locationDescription || '').length}</span> / 500 characters</p>
    </div>
    <div class="map-shell review-map-shell">
      <div id="description-map" class="map-canvas" role="region" aria-label="Map preview of the selected audit location"></div>
    </div>
    <div id="description-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="description-back" type="button">Back</button>
      <button class="button is-primary" id="description-next" type="button">Next</button>
    </div>`
  });
  const input = document.querySelector('#location-description');
  input.addEventListener('input', () => {
    document.querySelector('#description-count').textContent = input.value.length;
    wizard.draft.locationDescription = input.value;
    writeAuditCache();
  });
  document.querySelector('#description-back').addEventListener('click', () => {
    wizard.step = 2;
    renderAuditWizardScreen();
  });
  document.querySelector('#description-next').addEventListener('click', async (event) => {
    const description = input.value.trim().replace(/\s+/g, ' ');
    const errorBox = document.querySelector('#description-error');
    if (!description) {
      errorBox.textContent = 'Enter a location description.';
      errorBox.hidden = false;
      return;
    }
    const button = event.currentTarget;
    button.classList.add('is-loading');
    try {
      await persistAuditDraft({ locationDescription: description });
      wizard.step = 4;
      renderAuditWizardScreen();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.classList.remove('is-loading');
    }
  });
  initializeFeaturePreviewMap('description-map', wizard.study.area, wizard.draft.geojson, wizard.draft.locationGps);
  pageReady();
}

function initializeFeaturePreviewMap(elementId, area, feature, locationGps) {
  const map = createMap(elementId, { scrollWheelZoom: false, dragging: true });
  const targetBounds = boundsFromFeature(feature);
  if (targetBounds?.isValid()) {
    const southWest = targetBounds.getSouthWest();
    const northEast = targetBounds.getNorthEast();
    if (southWest.equals(northEast)) map.setView(southWest, 18);
    else map.fitBounds(targetBounds, { padding: [50, 50], maxZoom: 18 });
  } else if (locationGps) {
    map.setView([locationGps.latitude, locationGps.longitude], 18);
  } else {
    map.setView(areaCenter(area), 16);
  }

  L.geoJSON(area, { style: { color: '#9a7700', weight: 3, fillColor: '#f5c842', fillOpacity: 0.14 } }).addTo(map);
  const targetLayer = L.geoJSON(feature, {
    style: { color: '#d3263e', weight: 9, opacity: 1 },
    pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
      radius: 13, color: '#ffffff', weight: 4, fillColor: '#d3263e', fillOpacity: 1
    })
  }).addTo(map);
  targetLayer.bringToFront?.();
  if (locationGps) {
    L.circleMarker([locationGps.latitude, locationGps.longitude], {
      radius: 5, color: '#711625', weight: 2, fillColor: '#ffffff', fillOpacity: 1
    }).addTo(map);
  }
  requestAnimationFrame(() => map.invalidateSize());
}

async function ensureWorksheets() {
  const wizard = state.auditWizard;
  if (wizard.worksheets?.type === wizard.draft.type) return wizard.worksheets.items;
  const result = await api(`/api/worksheets?type=${encodeURIComponent(wizard.draft.type)}`);
  wizard.worksheets = { type: wizard.draft.type, items: result.worksheets };
  return result.worksheets;
}

async function renderWorksheetStep() {
  const wizard = state.auditWizard;
  appRoot.innerHTML = loadingMarkup('Loading recommended worksheets…');
  const worksheets = await ensureWorksheets();
  if (state.auditWizard !== wizard || wizard.step !== 4) return;
  appRoot.innerHTML = auditWizardFrame({
    step: 4,
    title: 'Choose a worksheet',
    help: `These worksheets are recommended for a ${wizard.draft.type === 'intersection' ? 'single intersection' : 'street segment'}.`,
    content: `<div class="option-list" role="radiogroup" aria-label="Recommended worksheets">
      ${worksheets.map((worksheet) => `<label class="option-row">
        <input type="radio" name="worksheet" value="${worksheet.id}" ${wizard.draft.worksheetId === worksheet.id ? 'checked' : ''}>
        <span><strong>${escapeHtml(worksheet.title)}</strong><br><span class="help">${escapeHtml(worksheet.description)}</span></span>
      </label>`).join('')}
    </div>
    <p class="help mt-4">Digital adaptations based on the <a href="${escapeHtml(worksheets[0]?.sourceUrl || '#')}" target="_blank" rel="noopener">AARP Walk Audit Tool Kit worksheets</a>.</p>
    <div id="worksheet-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="worksheet-back" type="button">Back</button>
      <button class="button is-primary" id="worksheet-next" type="button" ${wizard.draft.worksheetId ? '' : 'disabled'}>Next</button>
    </div>`
  });
  document.querySelectorAll('input[name="worksheet"]').forEach((input) => input.addEventListener('change', () => {
    const previous = wizard.draft.worksheetId;
    wizard.draft.worksheetId = Number(input.value);
    if (previous && previous !== wizard.draft.worksheetId) wizard.draft.answers = {};
    document.querySelector('#worksheet-next').disabled = false;
    writeAuditCache();
  }));
  document.querySelector('#worksheet-back').addEventListener('click', () => {
    wizard.step = 3;
    renderAuditWizardScreen();
  });
  document.querySelector('#worksheet-next').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    try {
      await persistAuditDraft({ worksheetId: wizard.draft.worksheetId, answers: wizard.draft.answers });
      wizard.questionIndex = 0;
      wizard.step = 5;
      renderAuditWizardScreen();
    } catch (error) {
      const errorBox = document.querySelector('#worksheet-error');
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.classList.remove('is-loading');
    }
  });
  pageReady();
}

function selectedWorksheet() {
  const wizard = state.auditWizard;
  return wizard.worksheets?.items?.find((worksheet) => worksheet.id === wizard.draft.worksheetId) || null;
}

function promptControl(prompt, answer) {
  if (prompt.type === 'textarea') {
    return `<div class="field"><label class="sr-only" for="prompt-answer">${escapeHtml(prompt.label)}</label>
      <textarea class="textarea" id="prompt-answer" maxlength="${prompt.maxLength || 2000}" rows="6" placeholder="Type your observation…">${escapeHtml(answer || '')}</textarea></div>`;
  }
  const multiple = prompt.type === 'multi-choice';
  const selected = multiple ? (Array.isArray(answer) ? answer : []) : [String(answer ?? '')];
  return `<div class="option-list" role="${multiple ? 'group' : 'radiogroup'}" aria-label="${escapeHtml(prompt.label)}">
    ${(prompt.options || []).map((option) => `<label class="option-row">
      <input type="${multiple ? 'checkbox' : 'radio'}" name="prompt-answer" value="${escapeHtml(option.value)}" ${selected.includes(String(option.value)) ? 'checked' : ''}>
      <span>${escapeHtml(option.label)}</span>
    </label>`).join('')}
  </div>`;
}

function readPromptAnswer(prompt) {
  if (prompt.type === 'textarea') {
    const value = document.querySelector('#prompt-answer').value.trim();
    return value || null;
  }
  if (prompt.type === 'multi-choice') {
    return [...document.querySelectorAll('input[name="prompt-answer"]:checked')].map((input) => input.value);
  }
  return document.querySelector('input[name="prompt-answer"]:checked')?.value || null;
}

async function renderQuestionStep() {
  const wizard = state.auditWizard;
  if (!wizard.worksheets) await ensureWorksheets();
  const worksheet = selectedWorksheet();
  if (!worksheet) {
    wizard.step = 4;
    return renderAuditWizardScreen();
  }
  const prompts = worksheet.prompts || [];
  if (!prompts.length) {
    wizard.step = 6;
    return renderAuditWizardScreen();
  }
  wizard.questionIndex = Math.min(wizard.questionIndex, prompts.length - 1);
  const prompt = prompts[wizard.questionIndex];
  const answer = wizard.draft.answers?.[prompt.id];
  appRoot.innerHTML = `<section class="wizard-shell">
    <div class="wizard-topline">
      <p class="eyebrow mb-0">${escapeHtml(worksheet.title)}</p>
      <span class="step-label">Question ${wizard.questionIndex + 1} of ${prompts.length}</span>
    </div>
    <div class="progress-track" role="progressbar" aria-label="Worksheet questions" aria-valuemin="1" aria-valuemax="${prompts.length}" aria-valuenow="${wizard.questionIndex + 1}">
      <div class="progress-fill" style="width:${((wizard.questionIndex + 1) / prompts.length) * 100}%"></div>
    </div>
    <h1 class="wizard-question">${escapeHtml(prompt.label)}</h1>
    ${prompt.help ? `<p class="wizard-help">${escapeHtml(prompt.help)}</p>` : ''}
    ${promptControl(prompt, answer)}
    ${prompt.optional ? '<p class="help mt-3">Optional — you can leave this blank.</p>' : '<p class="help mt-3">You can skip any question by tapping Next without choosing an answer.</p>'}
    <div id="question-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="question-back" type="button">Back</button>
      <button class="button is-primary" id="question-next" type="button">${wizard.questionIndex === prompts.length - 1 ? 'Review audit' : 'Next'}</button>
    </div>
  </section>`;

  if (prompt.type === 'multi-choice') {
    document.querySelectorAll('input[name="prompt-answer"]').forEach((input) => input.addEventListener('change', () => {
      if (input.value === 'none' && input.checked) {
        document.querySelectorAll('input[name="prompt-answer"]').forEach((other) => { if (other !== input) other.checked = false; });
      } else if (input.checked) {
        const none = document.querySelector('input[name="prompt-answer"][value="none"]');
        if (none) none.checked = false;
      }
    }));
  }
  document.querySelector('#question-back').addEventListener('click', () => {
    if (wizard.questionIndex > 0) wizard.questionIndex -= 1;
    else wizard.step = 4;
    renderAuditWizardScreen();
  });
  document.querySelector('#question-next').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    const nextAnswers = { ...(wizard.draft.answers || {}) };
    const nextAnswer = readPromptAnswer(prompt);
    if (nextAnswer === null || (Array.isArray(nextAnswer) && !nextAnswer.length)) delete nextAnswers[prompt.id];
    else nextAnswers[prompt.id] = nextAnswer;
    try {
      await persistAuditDraft({ answers: nextAnswers });
      if (wizard.questionIndex < prompts.length - 1) wizard.questionIndex += 1;
      else wizard.step = 6;
      renderAuditWizardScreen();
    } catch (error) {
      const errorBox = document.querySelector('#question-error');
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.classList.remove('is-loading');
    }
  });
  pageReady();
}

function answerDisplay(prompt, answer) {
  if (answer === undefined || answer === null || (Array.isArray(answer) && !answer.length)) return 'Skipped';
  if (prompt.type === 'textarea') return String(answer);
  const values = Array.isArray(answer) ? answer : [answer];
  return values.map((value) => prompt.options?.find((option) => String(option.value) === String(value))?.label || value).join(', ');
}

async function renderAuditReviewStep() {
  const wizard = state.auditWizard;
  if (!wizard.worksheets) await ensureWorksheets();
  const worksheet = selectedWorksheet();
  const prompts = worksheet?.prompts || [];
  appRoot.innerHTML = auditWizardFrame({
    step: 6,
    title: 'Review your walk audit',
    help: 'Check each section before saving. You can return to any step without losing your answers.',
    content: `<div class="review-list">
      ${reviewCard('Audit type', wizard.draft.type === 'intersection' ? 'Intersection' : 'Street segment', 1)}
      <article class="review-card">
        <div class="review-card-header"><span class="review-label">Location pin</span><button class="edit-link" type="button" data-edit-step="2">Edit</button></div>
        <div class="map-shell review-map-shell"><div id="review-location-map" class="map-canvas" role="region" aria-label="Map of the audit location"></div></div>
      </article>
      ${reviewCard('Location description', wizard.draft.locationDescription, 3)}
      ${reviewCard('Worksheet', worksheet?.title || 'Not selected', 4)}
      <article class="review-card">
        <div class="review-card-header"><span class="review-label">Answers</span><button class="edit-link" type="button" data-edit-step="5">Edit</button></div>
        <dl class="answers-list">
          ${prompts.map((prompt) => `<div class="answer-row"><dt>${escapeHtml(prompt.label)}</dt><dd>${escapeHtml(answerDisplay(prompt, wizard.draft.answers?.[prompt.id]))}</dd></div>`).join('')}
        </dl>
      </article>
    </div>
    <div id="review-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="review-back" type="button">Back</button>
      <button class="button is-primary" id="submit-final-audit" type="button">${wizard.editingAuditId ? 'Save audit' : 'Submit audit'}</button>
    </div>`
  });
  document.querySelectorAll('[data-edit-step]').forEach((button) => button.addEventListener('click', () => {
    wizard.step = Number(button.dataset.editStep);
    if (wizard.step === 5) wizard.questionIndex = 0;
    renderAuditWizardScreen();
  }));
  document.querySelector('#review-back').addEventListener('click', () => {
    wizard.step = 5;
    wizard.questionIndex = Math.max(prompts.length - 1, 0);
    renderAuditWizardScreen();
  });
  document.querySelector('#submit-final-audit').addEventListener('click', submitAuditWizard);
  initializeFeaturePreviewMap('review-location-map', wizard.study.area, wizard.draft.geojson, wizard.draft.locationGps);
  pageReady();
}

function reviewCard(label, value, editStep) {
  return `<article class="review-card">
    <div class="review-card-header"><span class="review-label">${escapeHtml(label)}</span><button class="edit-link" type="button" data-edit-step="${editStep}">Edit</button></div>
    <p>${escapeHtml(value || 'Not provided')}</p>
  </article>`;
}

async function submitAuditWizard(event) {
  const wizard = state.auditWizard;
  const button = event.currentTarget;
  const errorBox = document.querySelector('#review-error');
  button.classList.add('is-loading');
  errorBox.hidden = true;
  const request = {
    method: 'POST',
    url: `/api/drafts/${wizard.draft.id}/submit`,
    body: { editing: Boolean(wizard.editingAuditId) },
    meta: { cacheKey: wizard.cacheKey, studyId: wizard.studyId }
  };
  if (!navigator.onLine) {
    enqueueRequest(request);
    navigate(`/studies/${wizard.studyId}?pending=1`, { replace: true });
    state.auditWizard = null;
    return;
  }
  try {
    const sync = await flushOutbox();
    if (sync.pending) {
      enqueueRequest(request);
      state.auditWizard = null;
      navigate(`/studies/${wizard.studyId}?pending=1`, { replace: true });
      return;
    }
    await api(request.url, { method: request.method, body: request.body });
    localStorage.removeItem(wizard.cacheKey);
    state.auditWizard = null;
    navigate(`/studies/${wizard.studyId}?${wizard.editingAuditId ? 'saved' : 'submitted'}=1`, { replace: true });
  } catch (error) {
    if (error.isNetworkError || error.status >= 500) {
      enqueueRequest(request);
      state.auditWizard = null;
      navigate(`/studies/${wizard.studyId}?pending=1`, { replace: true });
      return;
    }
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    button.classList.remove('is-loading');
  }
}

async function renderAuditDetail(studyId, auditId, token) {
  const payload = await api(`/api/audits/${auditId}`);
  if (token !== state.routeToken) return;
  const { audit, study, permissions } = payload;
  if (study.id !== studyId) throw Object.assign(new Error('Audit not found in this study.'), { status: 404 });
  const prompts = audit.worksheetPrompts || [];
  appRoot.innerHTML = `<section class="page-shell narrow">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Completed walk audit</p>
        <h1 class="title is-2">${escapeHtml(audit.locationDescription)}</h1>
        <p class="subtitle">${escapeHtml(study.neighborhood)}</p>
      </div>
      ${permissions.canEdit ? '<button class="button is-primary" id="edit-audit" type="button">Edit audit</button>' : ''}
    </div>

    <div class="panel-card mb-4">
      <div class="map-shell detail-map-shell mb-4">
        <div id="audit-detail-map" class="map-canvas" role="region" aria-label="Map of the audited location"></div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><span class="detail-item-label">Type</span><strong>${audit.type === 'intersection' ? 'Intersection' : 'Street segment'}</strong></div>
        <div class="detail-item"><span class="detail-item-label">Submitted</span><strong>${escapeHtml(formatDateTime(audit.createdOn))}</strong></div>
        <div class="detail-item"><span class="detail-item-label">Contributor</span><strong>${escapeHtml(audit.contributorName)}</strong></div>
        <div class="detail-item"><span class="detail-item-label">Worksheet</span><strong>${escapeHtml(audit.worksheetTitle)}</strong></div>
      </div>
    </div>

    <div class="panel-card">
      <div class="section-heading"><h2 class="title is-4">Worksheet answers</h2></div>
      <dl class="answers-list">
        ${prompts.map((prompt) => `<div class="answer-row">
          <dt>${escapeHtml(prompt.label)}</dt>
          <dd>${escapeHtml(answerDisplay(prompt, audit.answers?.[prompt.id]))}</dd>
        </div>`).join('')}
      </dl>
    </div>

    <div class="button-row mt-5">
      <button class="button is-light" id="back-to-study" type="button">Back to study</button>
    </div>
  </section>`;
  document.querySelector('#back-to-study').addEventListener('click', () => navigate(`/studies/${study.id}`));
  document.querySelector('#edit-audit')?.addEventListener('click', () => navigate(`/studies/${study.id}/audits/${audit.id}/edit`));
  initializeFeaturePreviewMap('audit-detail-map', study.area, audit.geojson, audit.locationGps);
  pageReady();
}

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const navigateForTool = async (path) => {
    history.pushState({}, '', path);
    await renderRoute();
    return { path: location.pathname };
  };
  const positiveId = (value, label) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
    return number;
  };
  const tools = [
    {
      name: 'open_walk_audit_study',
      title: 'Open walk audit study',
      description: 'Navigate to an existing neighborhood walk-audit study by its numeric ID.',
      inputSchema: {
        type: 'object',
        properties: { studyId: { type: 'integer', minimum: 1 } },
        required: ['studyId'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: ({ studyId }) => navigateForTool(`/studies/${positiveId(studyId, 'studyId')}`)
    },
    {
      name: 'start_new_walk_audit_study',
      title: 'Start a new walk audit study',
      description: 'Open the visible new-study wizard. This only starts the flow; it does not create a study until the user draws and confirms a boundary.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => navigateForTool(state.user ? '/studies/new' : '/login?return=%2Fstudies%2Fnew')
    },
    {
      name: 'start_walk_audit_submission',
      title: 'Start a walk audit submission',
      description: 'Open the visible audit wizard for a study. This creates an autosaved draft but does not submit a completed audit.',
      inputSchema: {
        type: 'object',
        properties: { studyId: { type: 'integer', minimum: 1 } },
        required: ['studyId'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: ({ studyId }) => {
        const id = positiveId(studyId, 'studyId');
        const path = `/studies/${id}/audits/new`;
        return navigateForTool(state.user ? path : `/login?return=${encodeURIComponent(path)}`);
      }
    },
    {
      name: 'read_current_study_progress',
      title: 'Read current study progress',
      description: 'Return street, intersection, and audit counts for the study currently visible on screen.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => {
        const payload = state.currentStudyPayload;
        if (!payload) throw new Error('Open a study page first.');
        return {
          studyId: payload.study.id,
          neighborhood: payload.study.neighborhood,
          audits: payload.audits.length,
          streets: payload.progress.streets,
          intersections: payload.progress.intersections
        };
      }
    }
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(context.registerTool(tool)).catch(() => {});
    } catch (_error) {
      // WebMCP is optional and still experimental; the visible app remains fully usable.
    }
  }
}
