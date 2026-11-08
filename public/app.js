/* global L */
'use strict';

import { createSharedApi, reconstructAuditGeometry } from './shared-api.js';
import { initializeFirebaseAuth } from './firebase-auth.js';
import { enableMapPlacement } from './map-placement.js';
import { createQuestionnaireState, setTypeEnabled, addBankQuestion, addCustomQuestion, updateQuestion, removeQuestion, moveQuestion, serializeQuestionnaires, validateQuestionnaire } from './questionnaires.js';

let sharedApi = null;
let firebaseAuth = null;
const privateDraftCache = new Map();

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

function showBoundedError(box, message) {
  const pages = splitDisplayText(message, 100); let index = 0;
  box.hidden = false; box.setAttribute('role', 'alert');
  const render = () => {
    box.innerHTML = `<p>${escapeHtml(pages[index])}</p><div class="error-page-actions">${pages.length > 1 ? `<button class="button is-light" type="button" data-error-next>More (${index + 1}/${pages.length})</button>` : ''}<button class="button is-light" type="button" data-error-close>Dismiss</button></div>`;
    box.querySelector('[data-error-next]')?.addEventListener('click', () => { index = (index + 1) % pages.length; render(); });
    box.querySelector('[data-error-close]').addEventListener('click', () => { box.hidden = true; });
  };
  render();
}

async function api(url, options = {}) {
  if (sharedApi && url !== '/api/config') return sharedApi.request(url, options);
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
  if (sharedApi) return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const style = currentTheme() === 'dark' ? 'dark_all' : 'light_all';
  return `/api/tiles/carto/${style}/{z}/{x}/{y}.png?v=${encodeURIComponent(state.config.cartoTileVersion)}`;
}

function replaceTileLayer(map) {
  if (!map || !window.L) return;
  if (map._walkAuditTileLayer) map.removeLayer(map._walkAuditTileLayer);
  map._walkAuditTileLayer = L.tileLayer(tileUrl(), {
    maxZoom: 19,
    attribution: sharedApi ? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>' : '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  }).addTo(map);
}

function createMap(elementId, options = {}) {
  const renderer = L.canvas();
  // Leaflet 1.9 can retain an already queued redraw when a background map is
  // removed. Guard the callback itself as well as cancelling work on teardown.
  const redraw = renderer._redraw;
  renderer._redraw = function () {
    if (this._map && this._ctx) redraw.call(this);
  };
  const map = L.map(elementId, {
    zoomControl: false,
    attributionControl: true,
    fadeAnimation: false,
    touchZoom: true,
    dragging: true,
    bounceAtZoomLimits: false,
    preferCanvas: true,
    renderer,
    ...options
  });
  replaceTileLayer(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  state.activeMaps.push(map);
  const resize = () => { if (state.activeMaps.includes(map)) map.invalidateSize({ pan: false, animate: false }); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(map.getContainer());
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  map._walkAuditCleanup = () => { observer?.disconnect(); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  return map;
}

function destroyMaps() {
  for (const map of state.activeMaps) {
    try {
      map._walkAuditCleanup?.();
      // Remove paths before their canvas so teardown cannot enqueue a redraw
      // against a renderer whose drawing context has already been destroyed.
      map.eachLayer(layer => { if (layer instanceof L.Path) map.removeLayer(layer); });
      map.remove();
    } catch (_error) { /* map already removed */ }
  }
  state.activeMaps = [];
}

function scheduleMapResize(map) {
  requestAnimationFrame(() => {
    if (state.activeMaps.includes(map)) map.invalidateSize({ pan: false, animate: false });
  });
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
  if (sharedApi) return [];
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
  if (sharedApi) throw new Error('Reconnect to save. Your unsaved answers remain on this screen.');
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

function restorePagerFocus(preferred, fallback) {
  const focus = () => {
    const target = document.querySelector(preferred);
    const next = target && !target.disabled ? target : document.querySelector(fallback);
    next?.focus({ preventScroll: true });
  };
  focus();
  requestAnimationFrame(focus);
}

async function renderRoute() {
  const token = ++state.routeToken;
  destroyMaps();
  setViewportMode('normal');
  modalRoot.replaceChildren();
  state.currentStudyPayload = null;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const pathChanged = state.lastPath !== path;
  if (pathChanged && state.auditWizard) clearAuditWizard();
  state.lastPath = path;
  appRoot.innerHTML = loadingMarkup();

  try {
    if (path === '/' || path === '/login') {
      if (path === '/' && state.user) return await renderDashboard(token);
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
      return await renderAuditWizard(Number(match[1]), Number(match[2]), token);
    }
    match = path.match(/^\/studies\/(\d+)\/audits\/new$/);
    if (match) {
      if (!state.user) return navigate(`/login?return=${encodeURIComponent(path)}`, { replace: true });
      if (pathChanged) state.auditWizard = null;
      return await renderAuditWizard(Number(match[1]), null, token);
    }
    match = path.match(/^\/studies\/(\d+)\/audits\/(\d+)$/);
    if (match) return await renderAuditDetail(Number(match[1]), Number(match[2]), token);
    match = path.match(/^\/studies\/(\d+)$/);
    if (match) return await renderStudyPage(Number(match[1]), token);

    throw Object.assign(new Error('Page not found.'), { status: 404 });
  } catch (error) {
    if (token !== state.routeToken) return;
    appRoot.innerHTML = errorMarkup(error.message, error.status !== 404);
    document.querySelector('#retry-route')?.addEventListener('click', renderRoute);
    document.querySelector('#error-home')?.addEventListener('click', () => navigate('/'));
    pageReady();
  }
}

function clearAuditWizard() {
  const wizard = state.auditWizard;
  if (!wizard) return;
  clearTimeout(wizard.autosaveTimer);
  for (const slot of wizard.photoSlots?.values() || []) {
    if (slot.url && slot.privateUrl) sharedApi?.revokePhoto(slot.url);
    else if (slot.url?.startsWith('blob:')) URL.revokeObjectURL(slot.url);
  }
  state.auditWizard = null;
}

let viewportCleanup = null;
function setViewportMode(mode) {
  viewportCleanup?.(); viewportCleanup = null;
  document.body.classList.remove('is-login-screen');
  document.documentElement.classList.remove('is-login-screen');
  document.body.classList.toggle('is-map-viewport', mode === 'map');
  document.body.classList.toggle('is-compact-viewport', mode === 'compact');
  document.documentElement.classList.toggle('is-map-viewport', mode === 'map');
  document.documentElement.classList.toggle('is-compact-viewport', mode === 'compact');
  if (mode === 'normal') { document.documentElement.style.removeProperty('--walk-viewport-height'); document.body.classList.remove('viewport-constrained', 'text-zoomed', 'keyboard-constrained'); document.documentElement.classList.remove('viewport-constrained', 'text-zoomed', 'keyboard-constrained'); return; }
  let previousFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const update = () => {
    const height = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
    const width = Math.min(window.innerWidth, window.visualViewport?.width || window.innerWidth);
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const zoomed = fontSize > 20;
    const keyboard = mode === 'compact' && (height < 520 || width < 320);
    const constrained = mode === 'compact' && (zoomed || keyboard);
    const entering = constrained && !document.body.classList.contains('viewport-constrained');
    document.documentElement.style.setProperty('--walk-viewport-height', `${height}px`);
    document.body.classList.toggle('viewport-constrained', constrained);
    document.documentElement.classList.toggle('viewport-constrained', constrained);
    document.body.classList.toggle('text-zoomed', zoomed);
    document.documentElement.classList.toggle('text-zoomed', zoomed);
    document.body.classList.toggle('keyboard-constrained', keyboard);
    document.documentElement.classList.toggle('keyboard-constrained', keyboard);
    if (entering && document.body.classList.contains('is-login-screen')) {
      const panel = document.querySelector('.login-panel');
      if (panel) panel.dataset.loginStage = document.activeElement?.id === 'login-password' || document.activeElement?.id === 'create-account' ? 'password' : document.activeElement?.id === 'login-email' ? 'email' : 'choice';
    }
    if (fontSize !== previousFontSize && state.auditWizard && sharedApi && [1, 4, 5].includes(state.auditWizard.step)) {
      const wizard = state.auditWizard;
      queueMicrotask(() => { if (state.auditWizard === wizard) renderAuditWizardScreen(); });
    }
    previousFontSize = fontSize;
  };
  window.visualViewport?.addEventListener('resize', update);
  window.addEventListener('resize', update);
  viewportCleanup = () => { window.visualViewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  update();
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
    let config;
    try {
      const response = await fetch('/runtime-config.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('No static configuration');
      config = await response.json();
    } catch { config = await api('/api/config'); }
    state.config = config;
    if (config.backend === 'shared') {
      await unregisterServiceWorkers();
      firebaseAuth = await initializeFirebaseAuth(config);
      sharedApi = createSharedApi({ origin: config.apiOrigin, auth: firebaseAuth });
      document.querySelector('#offline-banner').textContent = 'Offline — reconnect to save. Keep this page open to retain unsaved answers.';
    }
    const session = await api('/api/session');
    state.user = session.user;
    if (sharedApi) {
      let previousUid = firebaseAuth.user()?.uid || null;
      firebaseAuth.onChange(async user => {
        if ((user?.uid || null) === previousUid) return;
        previousUid = user?.uid || null;
        const requestedUid = previousUid;
        state.routeToken++;
        destroyMaps();
        setViewportMode('normal');
        appRoot.innerHTML = loadingMarkup('Switching accounts…');
        modalRoot.replaceChildren();
        privateDraftCache.clear();
        clearAuditWizard();
        sharedApi.clear();
        state.studyWizard = null;
        state.currentStudyPayload = null;
        state.user = null;
        updateHeader();
        try {
          const profile = await sharedApi.getProfile();
          if ((firebaseAuth.user()?.uid || null) !== requestedUid) return;
          state.user = profile;
          updateHeader();
          if (user && !state.user) return renderNameStep(user.email || '', safeReturnPath(new URLSearchParams(location.search).get('return')));
          renderRoute();
        } catch (error) { if ((firebaseAuth.user()?.uid || null) === requestedUid) { renderRoute(); showToast(error.message, 'error'); } }
      });
    }
    updateHeader();
    await flushOutbox();
  } catch (error) {
    appRoot.innerHTML = errorMarkup(`Unable to connect: ${error.message}`);
    document.querySelector('#retry-route')?.addEventListener('click', () => location.reload());
    document.querySelector('#error-home')?.addEventListener('click', () => location.reload());
    return;
  }
  if (sharedApi && firebaseAuth.user() && !state.user) {
    renderNameStep(firebaseAuth.user().email || '', safeReturnPath(new URLSearchParams(location.search).get('return')));
  } else renderRoute();
  registerWebMcpTools();

  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocalHost && !sharedApi) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  } else {
    unregisterServiceWorkers();
  }
}

boot();

function renderFirebaseLogin() {
  setViewportMode('compact');
  document.body.classList.add('is-login-screen');
  document.documentElement.classList.add('is-login-screen');
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('return'));
  appRoot.innerHTML = `<section class="login-shell page-shell"><div class="panel-card login-panel" data-login-stage="choice">
    <h1 class="title">Volunteer sign-in</h1>
    <p class="subtitle">Sign in to organize studies and save walk audits.</p>
    <button id="google-sign-in" class="button is-primary is-fullwidth mb-5" type="button">Continue with Google</button>
    <button id="login-zoom-email" class="button is-link is-fullwidth" type="button">Continue with email</button>
    <form id="firebase-login-form">
      <div class="field" id="login-email-field"><label class="label" for="login-email">Email address</label>
        <input class="input" id="login-email" type="email" autocomplete="email" required></div>
      <div class="field" id="login-password-field"><label class="label" for="login-password">Password</label>
        <input class="input" id="login-password" type="password" autocomplete="current-password" minlength="6" required></div>
      <label class="checkbox mb-4" id="login-create-field"><input id="create-account" type="checkbox"> Create a new account</label>
      <button class="button is-link is-fullwidth" id="login-email-submit" type="submit">Continue with email</button>
    </form>
    <button class="button is-text mt-3" id="reset-password" type="button">Reset password</button>
    <p id="firebase-login-error" class="error-notice mt-4" hidden></p>
    <details class="login-help"><summary>Account help</summary><p>Accounts from the previous website are separate. Use a verified sign-in provider to create your new profile.</p></details>
    <div class="login-zoom-navigation"><button class="button is-light" id="login-zoom-back" type="button">Back</button><button class="button is-primary" id="login-zoom-next" type="button">Next</button></div>
  </div></section>`;
  const errorBox = document.querySelector('#firebase-login-error');
  async function signIn(work, button) {
    button.disabled = true;
    button.classList.add('is-loading');
    errorBox.hidden = true;
    try {
      const user = await work();
      const profile = await sharedApi.getProfile();
      if (!profile) return renderNameStep(user.email || '', returnTo);
      state.user = profile;
      updateHeader();
      navigate(returnTo || '/', { replace: true });
    } catch (error) {
      showBoundedError(errorBox, error.message);
    } finally { button.disabled = false; button.classList.remove('is-loading'); }
  }
  document.querySelector('#google-sign-in').addEventListener('click', event => signIn(() => firebaseAuth.google(), event.currentTarget));
  const loginPanel = document.querySelector('.login-panel');
  const setLoginStage = stage => { loginPanel.dataset.loginStage = stage; if (stage === 'email') document.querySelector('#login-email').focus(); else if (stage === 'password') document.querySelector('#login-password').focus(); };
  document.querySelector('#login-zoom-email').addEventListener('click', () => setLoginStage('email'));
  document.querySelector('#login-zoom-back').addEventListener('click', () => setLoginStage(loginPanel.dataset.loginStage === 'password' ? 'email' : 'choice'));
  document.querySelector('#login-zoom-next').addEventListener('click', () => { if (document.querySelector('#login-email').reportValidity()) setLoginStage('password'); });
  document.querySelector('#firebase-login-form').addEventListener('submit', event => {
    event.preventDefault();
    signIn(() => firebaseAuth.email(document.querySelector('#login-email').value.trim(), document.querySelector('#login-password').value, document.querySelector('#create-account').checked), event.currentTarget.querySelector('button'));
  });
  document.querySelector('#reset-password').addEventListener('click', async () => {
    try {
      const email = document.querySelector('#login-email').value.trim();
      if (!email) throw new Error('Enter your email address first.');
      await firebaseAuth.resetPassword(email);
      showToast('If this account exists, a password reset email is on its way.');
    } catch (error) { showBoundedError(errorBox, error.message); }
  });
  pageReady();
}

function renderLogin() {
  if (sharedApi) return renderFirebaseLogin();
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('return'));
  appRoot.innerHTML = `<section class="login-shell page-shell">
    <div class="panel-card login-panel">
      <h1 class="title">Volunteer sign-in</h1>
      <p class="subtitle">Enter your email to organize a study or contribute to one.</p>
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
  setViewportMode('normal');
  appRoot.innerHTML = `<section class="login-shell page-shell">
    <div class="panel-card login-panel">
      <p class="eyebrow">Welcome first-timer!</p>
      <h1 class="title">What's your name?</h1>
      <p class="subtitle">This will appear next to the audits you submit.</p>
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
      state.user = sharedApi
        ? await sharedApi.register(input.value)
        : (await api('/api/session', { method: 'POST', body: { email, name: input.value } })).user;
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
  const dashboard = await api('/api/dashboard');
  const { studies } = dashboard;
  if (token !== state.routeToken) return;
  const cards = items => items.map((study) => `<article class="study-card">
    <a href="/studies/${study.id}" data-nav>
      <img class="study-thumbnail" src="${escapeHtml(study.thumbnailPath)}" alt="Map thumbnail of the ${escapeHtml(study.neighborhood)} study area">
      <div class="study-card-body"><h2 class="study-card-title">${escapeHtml(study.neighborhood)} ${escapeHtml(monthYear(study.createdOn))}</h2>
        <p class="study-card-meta">${study.auditCount} ${study.auditCount === 1 ? 'audit' : 'audits'} · Started ${escapeHtml(formatDate(study.createdOn))}</p></div>
    </a></article>`).join('');
  const group = (name, title, page, empty) => `<section class="dashboard-group" data-dashboard-group="${name}"><h2 class="title is-4">${title}</h2>
    ${page.studies.length ? '' : `<p class="meta-line dashboard-empty">${empty}</p>`}
    <div class="study-grid">${cards(page.studies)}</div>
    <p class="error-notice mt-3" data-group-error hidden></p>
    <button class="button is-light mt-4" data-load-group="${name}" type="button" ${page.hasMore ? '' : 'hidden'}>Load more ${name === 'mine' ? 'your studies' : 'other studies'}</button></section>`;
  appRoot.innerHTML = `<section class="page-shell">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Your fieldwork</p>
        <h1 class="title is-2">Welcome, ${escapeHtml(state.user.name)}.</h1>
        <p class="subtitle">Studies you organize or contribute to appear here.</p>
      </div>
      <button class="button is-primary" id="start-study" type="button">Start new study</button>
    </div>
    ${sharedApi ? `${group('mine', 'Your studies', dashboard.minePage, 'Studies you organize or contribute to will appear here.')}${group('other', 'Other studies', dashboard.otherPage, 'There are no other studies yet.')}` : studies.length ? `<div class="study-grid">${cards(studies)}</div>` : `<div class="empty-state">
      <h2 class="title">No studies yet</h2>
      <p class="mb-4">Draw a neighborhood boundary, then invite volunteers to audit its streets and intersections.</p>
      <button class="button is-primary" id="empty-start-study" type="button">Start your first study</button>
    </div>`}
    <div class="mt-6">
      <button class="button is-light" id="sign-out" type="button">Sign out</button>
    </div>
  </section>`;

  const bindLinks = root => root.querySelectorAll('[data-nav]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); navigate(link.getAttribute('href')); }));
  bindLinks(appRoot);
  document.querySelectorAll('[data-load-group]').forEach(button => button.addEventListener('click', async () => {
    const name = button.dataset.loadGroup, section = button.closest('[data-dashboard-group]');
    const page = name === 'mine' ? dashboard.minePage : dashboard.otherPage;
    button.disabled = true;
    try {
      const next = await sharedApi.dashboardPage(name, page.studies.length);
      if (token !== state.routeToken) return;
      page.studies.push(...next.studies);
      const grid = section.querySelector('.study-grid');
      const wrapper = document.createElement('div'); wrapper.innerHTML = cards(next.studies); bindLinks(wrapper);
      grid.append(...wrapper.children);
      section.querySelector('.dashboard-empty')?.remove();
      button.hidden = !next.hasMore;
      section.querySelector('[data-group-error]').hidden = true;
    } catch (error) {
      const box = section.querySelector('[data-group-error]'); box.textContent = error.message; box.hidden = false;
    } finally { button.disabled = false; }
  }));
  document.querySelector('#start-study')?.addEventListener('click', () => navigate('/studies/new'));
  document.querySelector('#empty-start-study')?.addEventListener('click', () => navigate('/studies/new'));
  document.querySelector('#sign-out').addEventListener('click', async () => {
    await api('/api/session', { method: 'DELETE' });
    privateDraftCache.clear();
    clearAuditWizard();
    state.studyWizard = null;
    state.currentStudyPayload = null;
    if (sharedApi) {
      sharedApi.clear();
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('walkAuditDraft:') || key.startsWith('walkAuditOutbox:')) localStorage.removeItem(key);
      }
      await unregisterServiceWorkers();
    }
    state.user = null;
    updateHeader();
    navigate('/login', { replace: true });
  });
  pageReady();
}

function studyWizardFrame({ step, title, help, content, mapStep = false }) {
  const total = sharedApi ? 4 + (state.studyWizard?.questionnaireState?.enabledTypes.length || 0) : 2;
  return `<section class="wizard-shell ${mapStep ? 'is-map-step' : ''}">
    <div class="wizard-topline">
      <p class="eyebrow mb-0">New study</p>
      <span class="step-label">Step ${step} of ${total}</span>
    </div>
    <div class="progress-track" aria-label="Study setup progress"><div class="progress-fill" style="width:${(step / total) * 100}%"></div></div>
    <h1 class="wizard-question">${escapeHtml(title)}</h1>
    ${help ? `<p class="wizard-help">${escapeHtml(help)}</p>` : ''}
    ${content}
  </section>`;
}

function renderNewStudy() {
  if (!state.studyWizard) {
    state.studyWizard = { step: 1, neighborhood: '', vertices: [], error: null, questionnaireState: createQuestionnaireState(), bank: null };
  }
  const wizard = state.studyWizard;
  destroyMaps();
  setViewportMode(wizard.step === 2 ? 'map' : 'normal');
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

  if (sharedApi && wizard.step >= 3) return renderStudyQuestionnaires();

  appRoot.innerHTML = studyWizardFrame({
    step: 2,
    title: 'Draw the study area',
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
    <div id="boundary-error" class="error-notice mt-3" role="alert" ${wizard.error ? '' : 'hidden'}>${escapeHtml(wizard.error || '')}</div>`
  });
  initializeBoundaryMap();
  pageReady();
}

const studyTypeNames = { intersection: 'Intersection', 'street-segment': 'Street segment', point: 'Point' };

function renderStudyQuestionnaires() {
  const wizard = state.studyWizard;
  const form = wizard.questionnaireState;
  if (wizard.step === 3) {
    appRoot.innerHTML = studyWizardFrame({ step: 3, title: 'Choose audit types', help: 'Volunteers can use any type you enable. Each type has its own questions.', content: `
      <div class="option-list" aria-label="Enabled audit types">
        ${Object.entries(studyTypeNames).map(([type, label]) => `<label class="option-row"><input type="checkbox" data-study-type="${type}" ${form.enabledTypes.includes(type) ? 'checked' : ''}><span><strong>${escapeHtml(label)}</strong></span></label>`).join('')}
      </div>
      <div id="study-types-error" class="error-notice mt-3" hidden></div>
      <div class="wizard-actions"><button class="button is-light" id="study-types-back" type="button">Back</button><button class="button is-primary" id="study-types-next" type="button">Next</button></div>` });
    document.querySelectorAll('[data-study-type]').forEach(input => input.addEventListener('change', () => {
      wizard.questionnaireState = setTypeEnabled(wizard.questionnaireState, input.dataset.studyType, input.checked, wizard.bank);
    }));
    document.querySelector('#study-types-back').addEventListener('click', () => { wizard.step = 2; renderNewStudy(); });
    document.querySelector('#study-types-next').addEventListener('click', () => {
      if (!wizard.questionnaireState.enabledTypes.length) {
        const error = document.querySelector('#study-types-error'); error.textContent = 'Select at least one audit type.'; error.hidden = false; return;
      }
      wizard.step = 4; renderNewStudy();
    });
    pageReady(); return;
  }
  const enabled = form.enabledTypes;
  const editorIndex = wizard.step - 4;
  if (editorIndex < enabled.length) {
    const type = enabled[editorIndex], questions = form.questions[type];
    const available = wizard.bank.questions.filter(question => question.eligibleTypes.includes(type));
    appRoot.innerHTML = studyWizardFrame({ step: wizard.step, title: `${studyTypeNames[type]} questions`, help: 'Edit the questions volunteers will answer. You can add, remove, or reorder them.', content: `
      <div class="question-editor-list">
        ${questions.map((question, index) => `<article class="question-editor-card" data-question-id="${escapeHtml(question.id)}">
          <div class="question-editor-heading"><strong>Question ${index + 1}</strong><span class="help">${question.sourceQuestionId ? 'From the starter bank' : 'Custom question'}</span></div>
          <label class="label" for="label-${escapeHtml(question.id)}">Question text</label>
          <textarea class="textarea" id="label-${escapeHtml(question.id)}" data-question-field="label" rows="2" maxlength="500">${escapeHtml(question.label)}</textarea>
          ${question.type === 'choice' ? `<fieldset class="question-options"><legend class="label">Answer options</legend>${question.options.map((option, optionIndex) => `<div class="question-option"><label class="sr-only" for="option-${escapeHtml(question.id)}-${optionIndex}">Option ${optionIndex + 1}</label><input class="input" id="option-${escapeHtml(question.id)}-${optionIndex}" data-option-index="${optionIndex}" maxlength="200" value="${escapeHtml(option)}"><button class="button is-light" type="button" data-remove-option="${optionIndex}" aria-label="Remove option ${optionIndex + 1}">Remove</button></div>`).join('')}<button class="button is-light" type="button" data-add-option>Add option</button></fieldset>` : '<p class="help mt-3">Text answer, up to 2,000 characters.</p>'}
          <label class="checkbox question-required"><input type="checkbox" data-question-field="required" ${question.required ? 'checked' : ''}> Answer required</label>
          <div class="button-row"><button class="button is-light" type="button" data-move="-1" ${index === 0 ? 'disabled' : ''}>Move up</button><button class="button is-light" type="button" data-move="1" ${index === questions.length - 1 ? 'disabled' : ''}>Move down</button><button class="button is-light" type="button" data-remove-question>Remove question</button></div>
        </article>`).join('')}
      </div>
      <div class="panel-card mt-4"><label class="label" for="bank-question">Add a starter question</label><div class="question-add-row"><div class="select is-fullwidth"><select id="bank-question">${available.map(question => `<option value="${escapeHtml(question.id)}">${escapeHtml(question.prompt.label)}</option>`).join('')}</select></div><button class="button is-light" id="add-bank-question" type="button">Add</button></div><div class="button-row mt-3"><button class="button is-light" id="add-custom-text" type="button">Add custom text question</button><button class="button is-light" id="add-custom-choice" type="button">Add custom choice question</button></div></div>
      <div id="study-questions-error" class="error-notice mt-3" hidden></div>
      <div class="wizard-actions"><button class="button is-light" id="study-questions-back" type="button">Back</button><button class="button is-primary" id="study-questions-next" type="button">${editorIndex === enabled.length - 1 ? 'Review study' : 'Next type'}</button></div>` });
    const list = document.querySelector('.question-editor-list');
    const updateFromInput = event => {
      const card = event.target.closest('[data-question-id]'); if (!card) return;
      const id = card.dataset.questionId, current = wizard.questionnaireState.questions[type].find(question => question.id === id);
      if (!current) return;
      if (event.target.dataset.questionField === 'label') wizard.questionnaireState = updateQuestion(wizard.questionnaireState, type, id, { label: event.target.value });
      if (event.target.dataset.questionField === 'required') wizard.questionnaireState = updateQuestion(wizard.questionnaireState, type, id, { required: event.target.checked });
      if (event.target.dataset.optionIndex !== undefined) {
        const options = [...current.options]; options[Number(event.target.dataset.optionIndex)] = event.target.value;
        wizard.questionnaireState = updateQuestion(wizard.questionnaireState, type, id, { options });
      }
    };
    list.addEventListener('input', updateFromInput);
    list.addEventListener('change', updateFromInput);
    list.addEventListener('click', event => {
      const button = event.target.closest('button'), card = button?.closest('[data-question-id]'); if (!card) return;
      const id = card.dataset.questionId, current = wizard.questionnaireState.questions[type].find(question => question.id === id);
      if (button.hasAttribute('data-remove-question')) wizard.questionnaireState = removeQuestion(wizard.questionnaireState, type, id);
      else if (button.dataset.move) wizard.questionnaireState = moveQuestion(wizard.questionnaireState, type, id, Number(button.dataset.move));
      else if (button.hasAttribute('data-add-option')) wizard.questionnaireState = updateQuestion(wizard.questionnaireState, type, id, { options: [...current.options, ''] });
      else if (button.dataset.removeOption !== undefined) wizard.questionnaireState = updateQuestion(wizard.questionnaireState, type, id, { options: current.options.filter((_, index) => index !== Number(button.dataset.removeOption)) });
      else return;
      renderNewStudy();
    });
    document.querySelector('#add-bank-question').addEventListener('click', () => { wizard.questionnaireState = addBankQuestion(wizard.questionnaireState, type, document.querySelector('#bank-question').value, wizard.bank); renderNewStudy(); });
    for (const kind of ['text', 'choice']) document.querySelector(`#add-custom-${kind}`).addEventListener('click', () => { wizard.questionnaireState = addCustomQuestion(wizard.questionnaireState, type, kind); renderNewStudy(); });
    document.querySelector('#study-questions-back').addEventListener('click', () => { wizard.step--; renderNewStudy(); });
    document.querySelector('#study-questions-next').addEventListener('click', () => {
      const message = validateQuestionnaire(wizard.questionnaireState.questions[type]);
      if (message) { const box = document.querySelector('#study-questions-error'); box.textContent = message; box.hidden = false; return; }
      wizard.step++; renderNewStudy();
    });
    pageReady(); return;
  }
  appRoot.innerHTML = studyWizardFrame({ step: 4 + enabled.length, title: 'Review and create your study', help: 'These questions will be saved with the study for every contributor.', content: `
    <div class="review-list"><article class="review-card"><strong>${escapeHtml(wizard.neighborhood)}</strong><p>${wizard.vertices.length} boundary corners</p></article>
      ${enabled.map(type => `<article class="review-card"><h2 class="title is-5">${escapeHtml(studyTypeNames[type])}</h2><ol>${form.questions[type].map(question => `<li><strong>${escapeHtml(question.label)}</strong><span class="help">${question.required ? 'Required' : 'Optional'} · ${question.type === 'choice' ? 'Choice' : 'Text'}</span>${question.type === 'choice' ? `<ul>${question.options.map(option => `<li>${escapeHtml(option)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol></article>`).join('')}
    </div>
    <div id="study-create-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions"><button class="button is-light" id="study-review-back" type="button">Back</button><button class="button is-primary" id="study-create" type="button">Create study</button></div>` });
  document.querySelector('#study-review-back').addEventListener('click', () => { wizard.step--; renderNewStudy(); });
  document.querySelector('#study-create').addEventListener('click', createStudyFromWizard);
  pageReady();
}

function locateMap(map, onSuccess, shouldApply = () => true) {
  if (!navigator.geolocation) {
    showToast('Location services are not available in this browser.', 'error');
    return;
  }
  const button = document.activeElement;
  button?.classList?.add('is-loading');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      button?.classList?.remove('is-loading');
      if (!state.activeMaps.includes(map) || !shouldApply()) return;
      const latlng = [position.coords.latitude, position.coords.longitude];
      map.setView(latlng, Math.max(map.getZoom(), 17));
      onSuccess?.(position);
    },
    (error) => {
      button?.classList?.remove('is-loading');
      if (!state.activeMaps.includes(map)) return;
      showToast(error.code === 1 ? 'Location permission was not granted.' : 'Your location could not be determined.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }
  );
}

function initializeBoundaryMap() {
  const wizard = state.studyWizard;
  const map = createMap('boundary-map', { scrollWheelZoom: true });
  const errorBox = document.querySelector('#boundary-error');
  const clearError = () => { errorBox.textContent = ''; errorBox.hidden = true; wizard.error = null; };
  const showError = message => { errorBox.textContent = message; errorBox.hidden = false; };
  const sameCorner = (a, b) => a[0] === b[0] && a[1] === b[1];
  let manuallyMoved = false;
  const fallback = [32.7767, -96.797];
  if (wizard.vertices.length) {
    map.fitBounds(L.latLngBounds(wizard.vertices.map(([lng, lat]) => [lat, lng])), { padding: [60, 60], maxZoom: 17 });
  } else {
    map.setView(fallback, 13);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => { if (state.activeMaps.includes(map) && !manuallyMoved) map.setView([position.coords.latitude, position.coords.longitude], 15); },
        () => {},
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 120_000 }
      );
    }
  }
  map.on('dragstart zoomstart', () => { manuallyMoved = true; });

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
        clearError();
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
    const corner = [center.lng, center.lat];
    if (wizard.vertices.some(existing => sameCorner(existing, corner))) {
      showError('Move the map to a different location before adding another corner.');
      return;
    }
    clearError();
    wizard.vertices.push(corner);
    redraw();
    if (navigator.vibrate) navigator.vibrate(25);
  });
  document.querySelector('#boundary-undo').addEventListener('click', () => {
    wizard.vertices.pop();
    clearError();
    redraw();
  });
  document.querySelector('#boundary-clear').addEventListener('click', () => {
    wizard.vertices = [];
    clearError();
    redraw();
  });
  document.querySelector('#boundary-back').addEventListener('click', () => {
    wizard.step = 1;
    renderNewStudy();
  });
  document.querySelector('#boundary-finish').addEventListener('click', async (event) => {
    if (wizard.vertices.some((corner, index) => wizard.vertices.slice(0, index).some(existing => sameCorner(existing, corner)))) {
      showError('Each corner must be in a different place. Drag or remove any overlapping corners.');
      return;
    }
    clearError();
    if (!sharedApi) return createStudyFromWizard();
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (!wizard.bank) {
        const response = await fetch('/question-bank.json');
        if (!response.ok) throw new Error('The question catalog could not be loaded.');
        wizard.bank = await response.json();
      }
      if (state.studyWizard !== wizard) return;
      wizard.error = null;
      wizard.step = 3;
      renderNewStudy();
    } catch (error) {
      const box = document.querySelector('#boundary-error');
      if (box) { box.textContent = error.message; box.hidden = false; }
      button.disabled = false;
    }
  });
  redraw();
  scheduleMapResize(map);
}

function openStudyLoadingModal() {
  modalRoot.innerHTML = `<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="loading-title">
    <div class="modal-card-custom" tabindex="-1">
      <span class="loader-dot" aria-hidden="true"></span>
      <h2 class="title is-3 mt-4" id="loading-title">Building your study map</h2>
      <p>This can take up to two minutes while OpenStreetMap identifies auditable streets and intersections.</p>
      <div class="loading-phases" aria-live="polite">
        <div class="loading-phase is-active"><span class="phase-indicator"></span><span>Preparing the study boundary</span></div>
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
  if (wizard.vertices.length < 3 || wizard.creating) return;
  wizard.creating = true;
  const coordinates = [...wizard.vertices, wizard.vertices[0]];
  const area = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } };
  const closeModal = openStudyLoadingModal();
  try {
    const result = await api('/api/studies', {
      method: 'POST',
      body: { neighborhood: wizard.neighborhood, area, ...(sharedApi ? serializeQuestionnaires(wizard.questionnaireState, wizard.bank) : {}) }
    });
    closeModal();
    state.studyWizard = null;
    navigate(`/studies/${result.study.id}?created=1`, { replace: true });
  } catch (error) {
    wizard.creating = false;
    closeModal();
    wizard.error = error.message;
    const errorBox = document.querySelector('#study-create-error') || document.querySelector('#boundary-error');
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
          ${!sharedApi || study.allowedAuditTypes?.includes('street-segment') ? progressMarkup('Streets', progress.streets) : ''}
          ${!sharedApi || study.allowedAuditTypes?.includes('intersection') ? progressMarkup('Intersections', progress.intersections) : ''}
          ${progress.points ? `<p class="progress-caption">${progress.points.observations} point ${progress.points.observations === 1 ? 'observation' : 'observations'}</p>` : ''}
          ${progress.overall?.coverageApplicable === false ? '<p class="meta-line">Coverage not applicable</p>' : ''}
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
    if (button.disabled) return;
    button.disabled = true;
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
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  });

  initializeStudyMap(study, audits, progress);
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
    <p class="progress-caption">${item.audited} of ${item.total} mapped${item.partial ? ` · ${item.partial} partially covered` : ''}</p>
  </div>`;
}

function reportMarkup(report) {
  return `<article class="report-card">
    <p class="review-label">${escapeHtml(formatDateTime(report.createdOn))} · ${report.coverageApplicable === false ? 'Coverage not applicable' : `${percent(report.completion)} complete`}</p>
    <p class="mt-2">${escapeHtml(report.description)}</p>
  </article>`;
}

function initializeStudyMap(study, audits, progress) {
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

  const segmentIndex = new Map((study.segments?.features || []).map(feature => [feature.properties.id, feature]));
  for (const covered of progress?.streets?.coverage || []) {
    for (const [fromFraction, toFraction] of covered.intervals) {
      const geometry = reconstructAuditGeometry({ type: 'street-segment', featureId: covered.featureId, routeSelection: { edges: [{ featureId: covered.featureId, fromFraction, toFraction }] } }, study, segmentIndex);
      if (geometry) L.geoJSON(geometry, { interactive: false, style: { color: covered.complete ? '#087447' : '#c77c00', weight: 8, opacity: 0.8 } }).addTo(map);
    }
  }
  const latestByFeature = new Map();
  for (const audit of audits) {
    const id = audit.type === 'point' || audit.routeSelection ? `audit/${audit.id}` : `${audit.type}/${audit.featureId || audit.geojson?.properties?.id || audit.id}`;
    if (!latestByFeature.has(id)) latestByFeature.set(id, audit);
  }
  for (const audit of latestByFeature.values()) {
    if (!audit.geojson) continue;
    const layer = L.geoJSON(audit.geojson, {
      style: { color: '#075d55', weight: 5, opacity: 0.95 },
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
        radius: audit.type === 'point' ? 6 : 4, color: '#087447', weight: 2, fillColor: '#ffffff', fillOpacity: 1
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
  scheduleMapResize(map);
}

function auditCacheKey(studyId, editingAuditId) {
  return `walkAuditDraft:${sharedApi ? `shared:${state.config.apiOrigin}` : 'v1'}:${state.user?.id || 'guest'}:${studyId}:${editingAuditId || 'new'}`;
}

function readAuditCache(key) {
  if (sharedApi) return privateDraftCache.get(key) || null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (_error) {
    return null;
  }
}

function writeAuditCache() {
  const wizard = state.auditWizard;
  if (sharedApi) {
    if (wizard) privateDraftCache.set(wizard.cacheKey, { draftId: wizard.draft.id, draft: structuredClone(wizard.draft), step: wizard.step, questionIndex: wizard.questionIndex });
    return;
  }
  if (!wizard) return;
  localStorage.setItem(wizard.cacheKey, JSON.stringify({
    draftId: wizard.draft.id,
    draft: wizard.draft,
    step: wizard.step,
    questionIndex: wizard.questionIndex,
    savedOn: new Date().toISOString()
  }));
}

const editableDraftFields = new Set(['type', 'worksheetId', 'featureId', 'locationGps', 'locationDescription', 'geojson', 'routeSelection', 'answers']);
function newerDraftFields(current, before) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => editableDraftFields.has(key) && JSON.stringify(value) !== JSON.stringify(before[key])));
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
      if (sharedApi) draft = await sharedApi.resumeDraft(studyId, editingAuditId);
    }
    if (!draft) {
      if (!navigator.onLine) throw new Error('Reconnect once to start this audit. After it starts, every answer can be saved offline.');
      draft = (await api(`/api/studies/${studyId}/drafts`, {
        method: 'POST',
        body: { editingAuditId }
      })).draft;
    }
    let originalAudit = null;
    if (sharedApi && editingAuditId) originalAudit = (await sharedApi.raw(`audits/${editingAuditId}`)).audit;
    if (token !== state.routeToken) return;
    const assigned = draft.type && studyPayload.study.questionnaires?.[draft.type];
    const unboundDraft = !draft.type
      ? draft.worksheetId != null || draft.featureId != null || draft.locationGps != null || draft.locationDescription != null || draft.geojson != null || draft.routeSelection != null || Object.keys(draft.answers || {}).length > 0
      : draft.worksheetId == null && Object.keys(draft.answers || {}).length > 0;
    const draftMismatch = sharedApi && (editingAuditId
      ? draft.type !== originalAudit.type || draft.worksheetId !== originalAudit.worksheetId
      : unboundDraft || (draft.type && (!assigned || (draft.worksheetId != null && draft.worksheetId !== assigned.id))));
    state.auditWizard = {
      studyId,
      editingAuditId,
      study: studyPayload.study,
      draft,
      cacheKey,
      step: Math.min(Math.max(Number(cached?.step || (editingAuditId && sharedApi ? 2 : 1)), editingAuditId && sharedApi ? 2 : 1), sharedApi ? 5 : 6),
      questionIndex: Math.max(Number(cached?.questionIndex || 0), 0),
      worksheets: null,
      selectedFeature: draft.geojson || null,
      locationMarker: null,
      locationAccuracy: null,
      originalLegacyLocation: sharedApi && originalAudit?.type === 'street-segment' && !originalAudit.routeSelection
        ? { featureId: originalAudit.featureId, locationGps: structuredClone(originalAudit.locationGps), geojson: structuredClone(originalAudit.geojson) } : null,
      replaceLegacyRoute: Boolean(sharedApi && originalAudit?.type === 'street-segment' && !originalAudit.routeSelection && draft.routeSelection),
      draftMismatch
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
      <span class="step-label">Step ${step} of ${sharedApi ? 5 : 6}</span>
    </div>
    <div class="progress-track" aria-label="Audit progress"><div class="progress-fill" style="width:${(step / (sharedApi ? 5 : 6)) * 100}%"></div></div>
    <h1 class="wizard-question">${escapeHtml(title)}</h1>
    ${help ? `<p class="wizard-help">${escapeHtml(help)}</p>` : ''}
    ${content}
  </section>`;
}

async function renderAuditWizardScreen() {
  const wizard = state.auditWizard;
  destroyMaps();
  setViewportMode(wizard.step === 2 && !wizard.draftMismatch ? 'map' : !wizard.draftMismatch && (sharedApi ? [1, 4, 5].includes(wizard.step) : wizard.step === 4) ? 'compact' : 'normal');
  writeAuditCache();
  if (wizard.draftMismatch) return renderDraftMismatch();
  if (wizard.step === 1) return renderAuditTypeStep();
  if (wizard.step === 2) return renderAuditLocationStep();
  if (wizard.step === 3) return renderAuditDescriptionStep();
  if (wizard.step === 4) return sharedApi ? renderQuestionStep() : renderWorksheetStep();
  if (wizard.step === 5) return sharedApi ? renderAuditReviewStep() : renderQuestionStep();
  return renderAuditReviewStep();
}

function renderDraftMismatch() {
  const wizard = state.auditWizard;
  appRoot.innerHTML = `<section class="page-shell narrow"><div class="panel-card"><h1 class="title is-3">This saved draft uses an older audit definition</h1><p>Your earlier answers are preserved below. Start a separate draft to continue with the correct questions and audit type.</p><dl class="answers-list">${Object.entries(wizard.draft.answers || {}).map(([key, value]) => `<div class="answer-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><div id="draft-mismatch-error" class="error-notice mt-3" hidden></div><div class="button-row mt-4"><button class="button is-light" id="draft-mismatch-back" type="button">Back to study</button><button class="button is-primary" id="draft-mismatch-new" type="button">Start a separate draft</button></div></div></section>`;
  document.querySelector('#draft-mismatch-back').addEventListener('click', () => navigate(`/studies/${wizard.studyId}`));
  document.querySelector('#draft-mismatch-new').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      const result = await api(`/api/studies/${wizard.studyId}/drafts`, { method: 'POST', body: { editingAuditId: wizard.editingAuditId } });
      wizard.draft = result.draft; wizard.draftMismatch = false; wizard.step = wizard.editingAuditId ? 2 : 1; wizard.questionIndex = 0; wizard.worksheets = null;
      renderAuditWizardScreen();
    } catch (error) { const box = document.querySelector('#draft-mismatch-error'); box.textContent = error.message; box.hidden = false; event.currentTarget.disabled = false; }
  });
  pageReady();
}

async function persistAuditDraft(updates) {
  const wizard = state.auditWizard;
  clearTimeout(wizard.autosaveTimer);
  Object.assign(wizard.draft, structuredClone(updates));
  writeAuditCache();
  if (sharedApi) {
    const saving = structuredClone(wizard.draft);
    syncStatus.textContent = 'Saving…';
    try {
      const result = await api(`/api/drafts/${wizard.draft.id}`, { method: 'PATCH', body: updates });
      // A response to an earlier save must not replace text entered while it ran.
      const newer = newerDraftFields(wizard.draft, saving);
      wizard.draft = { ...result.draft, ...newer };
      writeAuditCache();
      syncStatus.textContent = Object.keys(newer).length ? 'Unsaved changes' : 'Saved';
      return result.draft;
    } catch (error) {
      syncStatus.textContent = 'Not saved — keep this page open';
      throw error;
    }
  }
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
  if (sharedApi && wizard.editingAuditId) { wizard.step = 2; return renderAuditWizardScreen(); }
  const types = sharedApi ? wizard.study.allowedAuditTypes || [] : ['intersection', 'street-segment'];
  const paged = document.body.classList.contains('text-zoomed');
  wizard.typePage = Math.max(0, Math.min(wizard.typePage || 0, types.length - 1));
  const visibleTypes = paged ? types.slice(wizard.typePage, wizard.typePage + 1) : types;
  appRoot.innerHTML = auditWizardFrame({
    step: 1,
    title: 'What are you auditing?',
    help: 'Choose the kind of mapped location your observation describes.',
    content: `<div class="${sharedApi ? 'option-list compact-type-list' : 'choice-grid'}" role="radiogroup" aria-label="Audit type">
      ${visibleTypes.map(type => `<label class="${sharedApi ? 'option-row' : 'choice-card'} ${wizard.draft.type === type ? 'is-selected' : ''}">
        <input type="radio" name="audit-type" value="${type}" ${wizard.draft.type === type ? 'checked' : ''}>
        <span><span class="choice-title">${escapeHtml(studyTypeNames[type])}</span><span class="choice-description">${type === 'intersection' ? 'A crossing where streets meet.' : type === 'point' ? 'One spot along a mapped street.' : sharedApi ? 'A route between a crossing and a street point.' : 'One mapped street segment.'}</span></span>
      </label>`).join('')}
    </div>
    ${paged && types.length > 1 ? `<div class="type-page-controls"><button class="button is-light" id="type-prev-page" type="button" ${wizard.typePage === 0 ? 'disabled' : ''}>Previous type</button><span class="help">${wizard.typePage + 1} / ${types.length}</span><button class="button is-light" id="type-next-page" type="button" ${wizard.typePage === types.length - 1 ? 'disabled' : ''}>More types</button></div>` : ''}
    <div id="audit-step-error" class="error-notice mt-4" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="audit-cancel" type="button">Back to study</button>
      <button class="button is-primary" id="type-next" type="button" ${wizard.draft.type ? '' : 'disabled'}>Next</button>
    </div>`
  });
  document.querySelector('#type-prev-page')?.addEventListener('click', () => { wizard.typePage--; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#type-prev-page', '#type-next-page')); });
  document.querySelector('#type-next-page')?.addEventListener('click', () => { wizard.typePage++; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#type-next-page', '#type-prev-page')); });

  document.querySelectorAll('input[name="audit-type"]').forEach((input) => input.addEventListener('change', () => {
    const changed = wizard.draft.type && wizard.draft.type !== input.value;
    wizard.draft.type = input.value;
    if (changed) Object.assign(wizard.draft, {
      worksheetId: null, featureId: null, locationGps: null, locationDescription: null, geojson: null, routeSelection: null, answers: {}
    });
    if (changed) { wizard.worksheets = null; wizard.routeState = null; wizard.selectedFeature = null; wizard.replaceLegacyRoute = false; }
    document.querySelectorAll('.choice-card, .compact-type-list .option-row').forEach((card) => card.classList.toggle('is-selected', card.contains(input)));
    document.querySelector('#type-next').disabled = false;
    writeAuditCache();
  }));
  document.querySelector('#audit-cancel').addEventListener('click', () => navigate(`/studies/${wizard.studyId}`));
  document.querySelector('#type-next').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    button.disabled = true;
    const choices = [...document.querySelectorAll('input[name="audit-type"]')];
    const pagers = [...document.querySelectorAll('#type-prev-page, #type-next-page')].map(element => ({ element, disabled: element.disabled }));
    choices.forEach(choice => { choice.disabled = true; });
    pagers.forEach(item => { item.element.disabled = true; });
    try {
      await persistAuditDraft(sharedApi ? { type: wizard.draft.type } : {
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
      if (sharedApi) showBoundedError(errorBox, error.message);
      else { errorBox.textContent = error.message; errorBox.hidden = false; }
      button.classList.remove('is-loading');
      button.disabled = false;
      choices.forEach(choice => { choice.disabled = false; });
      pagers.forEach(item => { item.element.disabled = item.disabled; });
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
  if (sharedApi && wizard.draft.type === 'street-segment') return renderRouteLocationStep();
  const typeLabel = wizard.draft.type === 'intersection' ? 'intersection' : wizard.draft.type === 'point' ? 'point' : 'street segment';
  appRoot.innerHTML = auditWizardFrame({
    step: 2,
    title: `Pin the ${typeLabel}`,
    help: 'We’ll start with your phone’s location. Tap the map or drag the pin to choose a location; the closest mapped location will highlight in red.',
    mapStep: true,
    content: `<div class="map-shell audit-map-shell">
      <div id="audit-location-map" class="map-canvas" role="region" aria-label="Map for selecting the audit location"></div>
      <div class="map-overlay-controls">
        <button class="map-control-button" id="audit-locate" type="button" aria-label="Use my current location" title="My location">◎</button>
      </div>
    </div>
    <div class="location-readout" aria-live="polite">
      <span class="location-dot" aria-hidden="true"></span>
      <div><strong id="snapped-description">Finding the nearest ${typeLabel}…</strong><p class="help" id="snapped-distance"></p><p class="help">Tap the map or drag the pin to move it.</p></div>
    </div>
    <div id="audit-location-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="location-back" type="button">Back</button>
      <button class="button is-primary" id="location-next" type="button" disabled>Next</button>
    </div>`
  });
  const placement = initializeAuditLocationMap();
  document.querySelector('#location-back').addEventListener('click', () => {
    if (sharedApi && wizard.editingAuditId) return navigate(`/studies/${wizard.studyId}`);
    wizard.step = 1;
    renderAuditWizardScreen();
  });
  document.querySelector('#location-next').addEventListener('click', async (event) => {
    placement.flush();
    const button = event.currentTarget;
    button.classList.add('is-loading');
    button.disabled = true;
    wizard.locationSaving = true;
    wizard.locationMarker?.dragging?.disable();
    document.querySelector('#audit-locate').disabled = true;
    document.querySelector('#location-back').disabled = true;
    try {
      await persistAuditDraft({
        ...(sharedApi ? { featureId: wizard.draft.featureId } : {}),
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
      button.disabled = false;
      wizard.locationSaving = false;
      wizard.locationMarker?.dragging?.enable();
      document.querySelector('#audit-locate').disabled = false;
      document.querySelector('#location-back').disabled = false;
    }
  });
  pageReady();
}

function initializeAuditLocationMap() {
  const wizard = state.auditWizard;
  wizard.locationSaving = false;
  const map = createMap('audit-location-map', { scrollWheelZoom: true });
  const hadSavedLocation = Boolean(wizard.draft.locationGps);
  let manuallyMoved = false, interactionVersion = 0;
  const markManual = () => { manuallyMoved = true; interactionVersion++; };
  const center = wizard.draft.locationGps
    ? [wizard.draft.locationGps.latitude, wizard.draft.locationGps.longitude]
    : areaCenter(wizard.study.area);
  map.setView(center, map._walkAuditTileLayer.options.maxZoom || 19);
  const areaLayer = L.geoJSON(wizard.study.area, {
    style: { color: '#9a7700', weight: 3, fillColor: '#f5c842', fillOpacity: 0.16 }
  }).addTo(map);
  map.on('dragstart zoomstart', markManual);

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
    const changedFeature = wizard.draft.geojson?.properties?.id !== match.feature.properties.id;
    wizard.selectedFeature = sharedApi && wizard.draft.type === 'point'
      ? { type: 'Feature', properties: structuredClone(match.feature.properties), geometry: { type: 'Point', coordinates: [match.latlng[1], match.latlng[0]] } }
      : structuredClone(match.feature);
    wizard.draft.featureId = match.feature.properties.id;
    wizard.draft.geojson = structuredClone(wizard.selectedFeature);
    wizard.draft.locationGps = sharedApi
      ? { latitude: match.latlng[0], longitude: match.latlng[1] }
      : { latitude: latlng.lat, longitude: latlng.lng };
    if (changedFeature || !wizard.draft.locationDescription) {
      wizard.draft.locationDescription = match.feature.properties?.description || match.feature.properties?.name
        || (wizard.draft.type === 'intersection' ? 'Selected intersection' : wizard.draft.type === 'point' ? 'Selected point' : 'Selected street segment');
    }
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

  marker.on('dragstart', markManual);
  marker.on('dragend', (event) => updateSelection(event.target.getLatLng()));
  marker.on('drag', (event) => {
    const latlng = event.target.getLatLng();
    wizard.draft.locationGps = { latitude: latlng.lat, longitude: latlng.lng };
  });
  const placement = enableMapPlacement(map, marker, {
    canSelect: () => !wizard.locationSaving,
    onIntent: markManual,
    onSelect: latlng => { marker.setLatLng(latlng); updateSelection(latlng); }
  });
  const oldCleanup = map._walkAuditCleanup;
  map._walkAuditCleanup = () => { placement.dispose(); oldCleanup?.(); };
  updateSelection(marker.getLatLng());

  function usePosition(position, explicit = false) {
    if (!state.activeMaps.includes(map) || wizard.locationSaving || (!explicit && manuallyMoved)) return;
    const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
    marker.setLatLng(latlng);
    map.setView(latlng, map._walkAuditTileLayer.options.maxZoom || 19);
    if (accuracyCircle) map.removeLayer(accuracyCircle);
    accuracyCircle = L.circle(latlng, {
      radius: Math.min(position.coords.accuracy, 200),
      color: '#147ca0', weight: 2, fillColor: '#52bde0', fillOpacity: 0.15, interactive: false
    }).addTo(map);
    updateSelection(latlng);
  }

  document.querySelector('#audit-locate').addEventListener('click', () => {
    placement.cancel();
    markManual();
    const version = interactionVersion;
    locateMap(map, position => usePosition(position, true), () => !wizard.locationSaving && version === interactionVersion);
  });
  if (!hadSavedLocation && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(position => usePosition(position), () => {}, {
      enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000
    });
  }
  scheduleMapResize(map);
  return placement;
}

function renderRouteLocationStep() {
  const wizard = state.auditWizard;
  const legacy = wizard.editingAuditId && !wizard.draft.routeSelection;
  if (legacy && !wizard.originalLegacyLocation) wizard.originalLegacyLocation = {
    featureId: wizard.draft.featureId, locationGps: structuredClone(wizard.draft.locationGps), geojson: structuredClone(wizard.draft.geojson)
  };
  const keepingLegacy = legacy && !wizard.replaceLegacyRoute;
  appRoot.innerHTML = auditWizardFrame({ step: 2, title: keepingLegacy ? 'Current street location' : 'Choose a street route', help: keepingLegacy ? 'Keep this location, or replace it with a two-pin route.' : 'Tap the map or drag each pin. Start at an intersection, then choose an endpoint on a street.', mapStep: true, content: `
    <div class="map-shell audit-map-shell"><div id="audit-location-map" class="map-canvas" role="region" aria-label="Map for selecting the street route"></div><div class="map-overlay-controls"><button class="map-control-button" id="audit-locate" type="button" aria-label="Use my current location">◎</button></div></div>
    <div class="location-readout route-readout" aria-live="polite"><div><strong id="route-status">${keepingLegacy ? 'Your existing street location is unchanged.' : 'Choose start A at an intersection.'}</strong><p class="help" id="route-detail">${keepingLegacy ? 'Keep this location, or replace it with a two-pin route.' : ''}</p>${keepingLegacy ? '' : '<p class="help">Tap the map or drag the pin to move it.</p>'}</div>
      ${keepingLegacy ? '' : `<div class="route-controls"><button class="button is-light" id="route-select-a" type="button">Start A</button><button class="button is-light" id="route-select-b" type="button">End B</button><button class="button is-light" id="route-show" type="button">Show route</button></div>`}</div>
    <div id="audit-location-error" class="error-notice" hidden></div>
    <div class="wizard-actions"><button class="button is-light" id="route-back" type="button">${wizard.replaceLegacyRoute ? 'Cancel change' : 'Back'}</button><button class="button is-primary" id="route-next" type="button">${keepingLegacy ? 'Keep location' : 'Confirm start A'}</button>${keepingLegacy ? '<button class="button is-link" id="route-replace" type="button">Replace location</button>' : ''}</div>` });
  const map = createMap('audit-location-map', { scrollWheelZoom: true });
  const savedEnd = (wizard.routeState?.phase === 'end' && wizard.routeState.end?.locationGps) || wizard.draft.routeSelection?.end?.locationGps;
  const startPosition = savedEnd || wizard.draft.locationGps;
  const center = startPosition ? [startPosition.latitude, startPosition.longitude] : areaCenter(wizard.study.area);
  map.setView(center, map._walkAuditTileLayer.options.maxZoom || 19);
  L.geoJSON(wizard.study.area, { style: { color: '#9a7700', weight: 3, fillColor: '#f5c842', fillOpacity: 0.12 } }).addTo(map);
  L.geoJSON(wizard.study.segments, { style: { color: '#526e73', weight: 3, opacity: 0.6 } }).addTo(map);
  const back = document.querySelector('#route-back'), next = document.querySelector('#route-next'), errorBox = document.querySelector('#audit-location-error');
  if (keepingLegacy) {
    if (wizard.draft.geojson) L.geoJSON(wizard.draft.geojson, { style: { color: '#d3263e', weight: 8 } }).addTo(map);
    document.querySelector('#route-replace').addEventListener('click', () => { wizard.replaceLegacyRoute = true; wizard.routeState = null; renderAuditWizardScreen(); });
    next.addEventListener('click', () => { wizard.step = 3; renderAuditWizardScreen(); });
    back.addEventListener('click', () => navigate(`/studies/${wizard.studyId}`));
    document.querySelector('#audit-locate').addEventListener('click', () => locateMap(map, position => map.setView([position.coords.latitude, position.coords.longitude], map._walkAuditTileLayer.options.maxZoom || 19)));
    scheduleMapResize(map); pageReady(); return;
  }
  const saved = wizard.draft.routeSelection;
  const route = wizard.routeState || (wizard.routeState = { startId: saved?.startIntersectionId || null, end: saved?.end || null, phase: saved?.startIntersectionId ? 'end' : 'start', preview: null });
  let previewTimer, previewSequence = 0, previewController, highlighted, routeLayer, otherMarker, manual = false, interactionVersion = 0, saving = false, candidate = null;
  const markManual = () => { manual = true; interactionVersion++; };
  const initialSaved = Boolean(startPosition);
  const icon = label => L.divIcon({ className: '', html: `<span class="route-pin">${label}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
  const marker = L.marker(center, { draggable: true, keyboard: true, icon: icon(route.phase === 'start' ? 'A' : 'B'), title: 'Route endpoint' }).addTo(map);
  const oldCleanup = map._walkAuditCleanup;
  map._walkAuditCleanup = () => { clearTimeout(previewTimer); previewController?.abort(); oldCleanup?.(); };
  map.on('dragstart zoomstart', markManual);
  marker.on('dragstart', markManual);

  function updateOtherMarker() {
    if (otherMarker) map.removeLayer(otherMarker);
    if (route.phase === 'end' && route.startId) {
      const start = wizard.study.intersections.features.find(feature => feature.properties.id === route.startId);
      if (start) otherMarker = L.marker([start.geometry.coordinates[1], start.geometry.coordinates[0]], { icon: icon('A'), interactive: false }).addTo(map);
    } else if (route.phase === 'start' && route.end) {
      otherMarker = L.marker([route.end.locationGps.latitude, route.end.locationGps.longitude], { icon: icon('B'), interactive: false }).addTo(map);
    }
  }
  function updateControls() {
    document.querySelector('#route-select-a').disabled = route.phase === 'start';
    document.querySelector('#route-select-b').disabled = !route.startId || route.phase === 'end';
    document.querySelector('#route-show').disabled = !route.preview;
    next.textContent = route.phase === 'start' ? 'Confirm start A' : 'Next';
    next.disabled = route.phase === 'start' ? !candidate : !route.preview;
    updateOtherMarker();
  }
  function clearPreview() {
    previewSequence++; clearTimeout(previewTimer); previewController?.abort(); route.preview = null;
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  }
  function preview() {
    clearPreview();
    if (!route.startId || !route.end) { updateControls(); return; }
    const sequence = previewSequence;
    const intent = { startIntersectionId: route.startId, end: structuredClone(route.end) };
    document.querySelector('#route-detail').textContent = 'Finding the shortest connected route…';
    previewTimer = setTimeout(async () => {
      previewController = new AbortController();
      try {
        const result = await sharedApi.previewRoute(wizard.studyId, intent, previewController.signal);
        if (sequence !== previewSequence || !state.activeMaps.includes(map)) return;
        route.preview = result;
        routeLayer = L.geoJSON(result.geojson, { style: { color: '#d3263e', weight: 8, opacity: 0.95 } }).addTo(map);
        document.querySelector('#route-detail').textContent = `${Math.round(result.routeSelection.lengthMeters)} m along the study network.`;
        errorBox.hidden = true;
      } catch (error) {
        if (sequence !== previewSequence || !state.activeMaps.includes(map)) return;
        document.querySelector('#route-detail').textContent = error.message;
      }
      updateControls();
    }, 300);
    updateControls();
  }
  function select(latlng) {
    if (highlighted) map.removeLayer(highlighted);
    const match = nearestStudyFeature(wizard.study, route.phase === 'start' ? 'intersection' : 'street-segment', [latlng.lat, latlng.lng]);
    if (!match) {
      candidate = null; if (route.phase === 'end') { route.end = null; clearPreview(); }
      document.querySelector('#route-status').textContent = route.phase === 'start' ? 'No mapped intersection is available.' : 'No mapped street is available.';
      updateControls(); return;
    }
    candidate = match; marker.setLatLng(match.latlng);
    highlighted = L.geoJSON(match.feature, { style: { color: '#d3263e', weight: 7 }, pointToLayer: (_feature, point) => L.circleMarker(point, { radius: 10, color: '#fff', weight: 3, fillColor: '#d3263e', fillOpacity: 1 }) }).addTo(map);
    document.querySelector('#route-status').textContent = route.phase === 'start' ? 'Start A: select an intersection' : 'End B: select a street or midblock point';
    if (route.phase === 'end') {
      route.end = { featureId: match.feature.properties.id, locationGps: { longitude: match.latlng[1], latitude: match.latlng[0] } };
      preview();
    } else { clearPreview(); document.querySelector('#route-detail').textContent = match.feature.properties.name || 'Tap the map or drag A to the starting intersection.'; updateControls(); }
  }
  const placement = enableMapPlacement(map, marker, {
    canSelect: () => !saving,
    onIntent: markManual,
    onSelect: select
  });
  const cleanupBeforePlacement = map._walkAuditCleanup;
  map._walkAuditCleanup = () => { placement.dispose(); cleanupBeforePlacement?.(); };
  marker.on('dragend', event => select(event.target.getLatLng()));
  document.querySelector('#route-select-a').addEventListener('click', () => {
    placement.cancel();
    markManual();
    route.phase = 'start'; marker.setIcon(icon('A'));
    const start = wizard.study.intersections.features.find(feature => feature.properties.id === route.startId);
    if (start) { marker.setLatLng([start.geometry.coordinates[1], start.geometry.coordinates[0]]); map.setView(marker.getLatLng(), map.getZoom()); }
    select(marker.getLatLng());
  });
  document.querySelector('#route-select-b').addEventListener('click', () => {
    placement.cancel();
    markManual();
    route.phase = 'end'; marker.setIcon(icon('B'));
    if (route.end) marker.setLatLng([route.end.locationGps.latitude, route.end.locationGps.longitude]);
    map.setView(marker.getLatLng(), map.getZoom()); select(marker.getLatLng());
  });
  document.querySelector('#route-show').addEventListener('click', () => { placement.cancel(); markManual(); const bounds = routeLayer?.getBounds(); if (bounds?.isValid()) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 19 }); });
  next.addEventListener('click', async () => {
    placement.flush();
    // A newly selected endpoint must finish its route preview before saving.
    if (next.disabled) return;
    next.disabled = true; errorBox.hidden = true; saving = true;
    marker.dragging.disable(); back.disabled = true;
    document.querySelector('#audit-locate').disabled = true;
    document.querySelector('#route-select-a').disabled = true;
    document.querySelector('#route-select-b').disabled = true;
    try {
      if (route.phase === 'start') {
        route.startId = candidate.feature.properties.id;
        await persistAuditDraft({ routeSelection: { startIntersectionId: route.startId } });
        route.phase = 'end'; renderAuditWizardScreen();
      } else {
        if (!route.preview) return;
        await persistAuditDraft({ routeSelection: { startIntersectionId: route.startId, end: route.end }, locationDescription: wizard.draft.locationDescription || 'Selected street route' });
        wizard.step = 3; renderAuditWizardScreen();
      }
    } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; saving = false; marker.dragging.enable(); back.disabled = false; document.querySelector('#audit-locate').disabled = false; updateControls(); }
  });
  back.addEventListener('click', async () => {
    placement.cancel();
    if (wizard.replaceLegacyRoute && wizard.originalLegacyLocation) {
      back.disabled = true;
      try {
        if (wizard.draft.routeSelection) await persistAuditDraft({ routeSelection: null, ...wizard.originalLegacyLocation });
        wizard.replaceLegacyRoute = false; wizard.routeState = null; renderAuditWizardScreen();
      } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; back.disabled = false; }
      return;
    }
    if (wizard.editingAuditId) return navigate(`/studies/${wizard.studyId}`);
    wizard.step = 1; renderAuditWizardScreen();
  });
  function usePosition(position, explicit = false) {
    if (!state.activeMaps.includes(map) || saving || (!explicit && manual)) return;
    const latlng = [position.coords.latitude, position.coords.longitude]; marker.setLatLng(latlng); map.setView(latlng, map._walkAuditTileLayer.options.maxZoom || 19); select(marker.getLatLng());
  }
  document.querySelector('#audit-locate').addEventListener('click', () => {
    placement.cancel();
    markManual();
    const version = interactionVersion;
    locateMap(map, position => usePosition(position, true), () => !saving && version === interactionVersion);
  });
  select(marker.getLatLng());
  if (!initialSaved && navigator.geolocation) navigator.geolocation.getCurrentPosition(position => usePosition(position), () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
  scheduleMapResize(map); pageReady();
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
    button.disabled = true;
    input.disabled = true;
    document.querySelector('#description-back').disabled = true;
    try {
      await persistAuditDraft({ locationDescription: description });
      wizard.step = 4;
      renderAuditWizardScreen();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.classList.remove('is-loading');
      button.disabled = false;
      input.disabled = false;
      document.querySelector('#description-back').disabled = false;
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
  scheduleMapResize(map);
}

async function ensureWorksheets() {
  const wizard = state.auditWizard;
  if (wizard.worksheets?.type === wizard.draft.type) return wizard.worksheets.items;
  if (sharedApi) {
    const definition = wizard.study.questionnaires?.[wizard.draft.type];
    const worksheet = wizard.editingAuditId && wizard.draft.worksheetId !== definition?.id
      ? await sharedApi.worksheet(wizard.draft.worksheetId) : definition;
    if (!worksheet || worksheet.id !== wizard.draft.worksheetId) throw new Error('This draft does not match the study questions. Start a separate draft to continue.');
    wizard.worksheets = { type: wizard.draft.type, items: [worksheet] };
    return wizard.worksheets.items;
  }
  const result = await api(`/api/worksheets?type=${encodeURIComponent(wizard.draft.type)}`);
  wizard.worksheets = { type: wizard.draft.type, items: result.worksheets };
  return result.worksheets;
}

async function renderWorksheetStep() {
  const wizard = state.auditWizard;
  appRoot.innerHTML = loadingMarkup('Loading recommended worksheets…');
  const worksheets = await ensureWorksheets();
  if (state.auditWizard !== wizard || wizard.step !== 4) return;
  const pages = worksheets.flatMap(worksheet => splitDisplayText(worksheet.description || '', 120).map(description => ({ worksheet, description })));
  wizard.worksheetPage = Math.max(0, Math.min(wizard.worksheetPage || 0, pages.length - 1));
  const page = pages[wizard.worksheetPage];
  appRoot.innerHTML = auditWizardFrame({
    step: 4,
    title: 'Choose a worksheet',
    help: `These worksheets are recommended for a ${wizard.draft.type === 'intersection' ? 'single intersection' : 'street segment'}.`,
    content: `<div class="option-list" role="radiogroup" aria-label="Recommended worksheets">
      ${page ? `<label class="option-row">
        <input type="radio" name="worksheet" value="${page.worksheet.id}" ${wizard.draft.worksheetId === page.worksheet.id ? 'checked' : ''}>
        <span><strong>${escapeHtml(page.worksheet.title)}</strong><br><span class="help">${escapeHtml(page.description)}</span></span>
      </label>` : '<p>No worksheets are available for this type.</p>'}
    </div>
    ${pages.length > 1 ? `<div class="worksheet-page-controls"><button class="button is-light" id="worksheet-prev-page" type="button" ${wizard.worksheetPage === 0 ? 'disabled' : ''}>Previous</button><span class="help">${wizard.worksheetPage + 1} / ${pages.length}</span><button class="button is-light" id="worksheet-next-page" type="button" ${wizard.worksheetPage === pages.length - 1 ? 'disabled' : ''}>More choices</button></div>` : ''}
    <p class="help mt-3"><a href="${escapeHtml(page?.worksheet.sourceUrl || '#')}" target="_blank" rel="noopener">AARP Walk Audit Tool Kit worksheets</a>.</p>
    <div id="worksheet-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="worksheet-back" type="button">Back</button>
      <button class="button is-primary" id="worksheet-next" type="button" ${wizard.draft.worksheetId ? '' : 'disabled'}>Next</button>
    </div>`
  });
  document.querySelector('#worksheet-prev-page')?.addEventListener('click', () => { wizard.worksheetPage--; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#worksheet-prev-page', '#worksheet-next-page')); });
  document.querySelector('#worksheet-next-page')?.addEventListener('click', () => { wizard.worksheetPage++; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#worksheet-next-page', '#worksheet-prev-page')); });
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
    button.disabled = true;
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
      button.disabled = false;
    }
  });
  pageReady();
}

function selectedWorksheet() {
  const wizard = state.auditWizard;
  return wizard.worksheets?.items?.find((worksheet) => worksheet.id === wizard.draft.worksheetId) || null;
}

function splitDisplayText(value, limit = 110) {
  let remaining = String(value || '').trim(); const pages = [];
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    pages.push(remaining.slice(0, cut).trim()); remaining = remaining.slice(cut).trim();
  }
  if (remaining || !pages.length) pages.push(remaining);
  return pages;
}

function promptControl(prompt, answer, visibleOptions = prompt.options) {
  if (prompt.type === 'textarea') {
    return `<div class="field"><label class="sr-only" for="prompt-answer">${escapeHtml(prompt.label)}</label>
      <textarea class="textarea" id="prompt-answer" maxlength="${prompt.maxLength || 2000}" rows="6" placeholder="Type your observation…">${escapeHtml(answer || '')}</textarea></div>`;
  }
  const multiple = prompt.type === 'multi-choice';
  const selected = multiple ? (Array.isArray(answer) ? answer : []) : [String(answer ?? '')];
  return `<div class="option-list" role="${multiple ? 'group' : 'radiogroup'}" aria-label="${escapeHtml(prompt.label)}">
    ${(visibleOptions || []).map((option) => `<label class="option-row">
      <input type="${multiple ? 'checkbox' : 'radio'}" name="prompt-answer" value="${escapeHtml(option.value)}" ${option.clearAnswer ? 'data-clear-answer="true"' : ''} ${selected.includes(String(option.value)) ? 'checked' : ''}>
      <span>${escapeHtml(option.label)}</span>
    </label>`).join('')}
  </div>`;
}

function readPromptAnswer(prompt) {
  if (prompt.type === 'textarea') {
    const field = document.querySelector('#prompt-answer');
    if (!field) return state.auditWizard.draft.answers?.[prompt.id] ?? null;
    const value = field.value.trim();
    return value || null;
  }
  if (prompt.type === 'multi-choice') {
    return [...document.querySelectorAll('input[name="prompt-answer"]:checked')].map((input) => input.value);
  }
  const selected = document.querySelector('input[name="prompt-answer"]:checked');
  if (selected?.dataset.clearAnswer) return null;
  return selected?.value || (sharedApi ? state.auditWizard.draft.answers?.[prompt.id] : null) || null;
}

async function renderQuestionStep() {
  const wizard = state.auditWizard;
  if (!wizard.worksheets) await ensureWorksheets();
  const worksheet = selectedWorksheet();
  if (!worksheet) {
    wizard.step = sharedApi ? 3 : 4;
    return renderAuditWizardScreen();
  }
  const prompts = worksheet.prompts || [];
  if (!prompts.length) {
    wizard.step = sharedApi ? 5 : 6;
    return renderAuditWizardScreen();
  }
  wizard.questionIndex = Math.min(wizard.questionIndex, prompts.length - 1);
  const prompt = prompts[wizard.questionIndex];
  const answer = wizard.draft.answers?.[prompt.id];
  const contentKey = `${worksheet.id}:${prompt.id}`;
  if (wizard.contentKey !== contentKey) { wizard.contentKey = contentKey; wizard.contentPage = 0; }
  const zoomScale = Math.max(1, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
  const labelLimit = zoomScale > 1.25 ? Math.max(25, Math.floor(80 / zoomScale)) : 110;
  const labelPages = sharedApi ? splitDisplayText(prompt.label, labelLimit) : [prompt.label];
  const optionPages = [];
  if (sharedApi && prompt.type !== 'textarea') {
    const limit = zoomScale > 1.25 ? Math.max(25, Math.floor(70 / zoomScale)) : 115;
    for (const [index, option] of (prompt.options || []).entries()) {
      const chunks = zoomScale > 1.25 ? splitDisplayText(option.label, limit) : [option.label];
      for (const [part, chunk] of chunks.entries()) {
        const displayed = chunks.length > 1 ? { ...option, label: `${chunk} (${part + 1}/${chunks.length})` } : option;
        let group = optionPages.at(-1);
        if (!group || chunks.length > 1 || group.length >= (zoomScale > 1.25 ? 1 : 3) || group.reduce((sum, item) => sum + item.label.length, 0) + displayed.label.length > limit) { group = []; optionPages.push(group); }
        group.push(displayed);
      }
    }
  }
  if (!optionPages.length) optionPages.push(prompt.options || []);
  if (sharedApi && prompt.optional && prompt.type === 'single-choice') optionPages.push([{ value: '', label: 'Clear answer', clearAnswer: true }]);
  const answerPage = labelPages.length - 1, pageCount = answerPage + optionPages.length;
  wizard.contentPage = Math.max(0, Math.min(wizard.contentPage || 0, pageCount - 1));
  const showAnswer = wizard.contentPage >= answerPage;
  const visibleOptions = optionPages[Math.max(0, wizard.contentPage - answerPage)];
  appRoot.innerHTML = `<section class="wizard-shell ${sharedApi ? 'compact-question' : ''}">
    <div class="wizard-topline">
      <p class="eyebrow mb-0">${escapeHtml(worksheet.title)}</p>
      <span class="step-label">Question ${wizard.questionIndex + 1} of ${prompts.length}</span>
    </div>
    <div class="progress-track" role="progressbar" aria-label="Worksheet questions" aria-valuemin="1" aria-valuemax="${prompts.length}" aria-valuenow="${wizard.questionIndex + 1}">
      <div class="progress-fill" style="width:${((wizard.questionIndex + 1) / prompts.length) * 100}%"></div>
    </div>
    <h1 class="wizard-question">${escapeHtml(labelPages[Math.min(wizard.contentPage, labelPages.length - 1)])}</h1>
    ${prompt.help ? `<p class="wizard-help">${escapeHtml(prompt.help)}</p>` : ''}
    ${showAnswer ? promptControl(prompt, answer, visibleOptions) : '<p class="help">More of this question follows.</p>'}
    ${pageCount > 1 ? `<p class="help question-part">Part ${wizard.contentPage + 1} of ${pageCount}${answer ? ' · Answer selected' : ''}</p>` : ''}
    ${showAnswer ? (prompt.optional ? '<p class="help mt-3">Optional — you can leave this blank.</p>' : `<p class="help mt-3">${sharedApi ? 'Choose an answer before continuing.' : 'You can skip any question by tapping Next without choosing an answer.'}</p>`) : ''}
    <div id="question-error" class="error-notice mt-3" hidden></div>
    <div class="wizard-actions">
      <button class="button is-light" id="question-back" type="button">Back</button>
      <button class="button is-primary" id="question-next" type="button">${wizard.contentPage < pageCount - 1 ? 'Next part' : wizard.questionIndex === prompts.length - 1 ? 'Review audit' : 'Next'}</button>
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
  function rememberAnswer() {
    const value = readPromptAnswer(prompt);
    const answers = { ...(wizard.draft.answers || {}) };
    if (value === null || (Array.isArray(value) && !value.length)) delete answers[prompt.id];
    else answers[prompt.id] = value;
    wizard.draft.answers = answers;
    writeAuditCache();
    if (sharedApi) {
      clearTimeout(wizard.autosaveTimer);
      syncStatus.textContent = 'Unsaved changes';
      wizard.autosaveTimer = setTimeout(async () => {
        if (state.auditWizard !== wizard) return;
        try { await persistAuditDraft({ answers: structuredClone(wizard.draft.answers) }); }
        catch (error) {
          if (state.auditWizard !== wizard) return;
          const errorBox = document.querySelector('#question-error');
          if (errorBox) { if (sharedApi) showBoundedError(errorBox, error.message); else { errorBox.textContent = error.message; errorBox.hidden = false; } }
          else showToast(error.message, 'error');
        }
      }, 700);
    }
  }
  document.querySelector('#prompt-answer')?.addEventListener('input', rememberAnswer);
  document.querySelectorAll('input[name="prompt-answer"]').forEach(input => input.addEventListener('change', rememberAnswer));
  document.querySelector('#question-back').addEventListener('click', () => {
    rememberAnswer();
    if (wizard.contentPage > 0) wizard.contentPage -= 1;
    else if (wizard.questionIndex > 0) wizard.questionIndex -= 1;
    else wizard.step = sharedApi ? 3 : 4;
    Promise.resolve(renderAuditWizardScreen()).then(() => { if (wizard.step === (sharedApi ? 4 : 5)) restorePagerFocus('#question-back', '#question-next'); });
  });
  document.querySelector('#question-next').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('is-loading');
    button.disabled = true;
    const nextAnswers = { ...(wizard.draft.answers || {}) };
    const nextAnswer = readPromptAnswer(prompt);
    if (wizard.contentPage < pageCount - 1) {
      rememberAnswer(); wizard.contentPage += 1; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#question-next', '#question-back')); return;
    }
    if (sharedApi && !prompt.optional && nextAnswer === null) {
      const errorBox = document.querySelector('#question-error');
      showBoundedError(errorBox, 'Please answer this question before continuing.');
      button.classList.remove('is-loading');
      button.disabled = false;
      return;
    }
    if (nextAnswer === null || (Array.isArray(nextAnswer) && !nextAnswer.length)) delete nextAnswers[prompt.id];
    else nextAnswers[prompt.id] = nextAnswer;
    try {
      await persistAuditDraft({ answers: nextAnswers });
      if (wizard.questionIndex < prompts.length - 1) wizard.questionIndex += 1;
      else wizard.step = sharedApi ? 5 : 6;
      renderAuditWizardScreen();
    } catch (error) {
      const errorBox = document.querySelector('#question-error');
      if (sharedApi) showBoundedError(errorBox, error.message);
      else { errorBox.textContent = error.message; errorBox.hidden = false; }
      button.classList.remove('is-loading');
      button.disabled = false;
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
  if (sharedApi) return renderSharedAuditReviewStep();
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

async function normalizePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('This image could not be decoded. Choose another photo.'); }
  try {
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('This browser could not prepare the photo.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85 - attempt * 0.12));
      if (blob && blob.size <= 2097152) return blob;
      scale *= 0.8;
    }
    throw new Error('This photo is too large after resizing. Choose a smaller image.');
  } finally { bitmap.close?.(); }
}

function mergePhotoDraft(wizard, before, draft) {
  const newer = newerDraftFields(wizard.draft, before);
  wizard.draft = { ...draft, ...newer };
  writeAuditCache();
}

function ensurePhotoSlots(wizard) {
  if (wizard.photoSlots) return;
  wizard.photoSlots = new Map();
  for (const photo of wizard.draft.photos || []) {
    const publicPhoto = photo.path?.includes('/audits/');
    const item = { descriptor: photo, status: publicPhoto ? 'ready' : 'loading', url: publicPhoto ? new URL(photo.path, state.config.apiOrigin).href : null };
    wizard.photoSlots.set(photo.slot, item);
    if (!publicPhoto) sharedApi.privatePhoto(wizard.draft.id, photo.slot).then(url => {
      if (state.auditWizard !== wizard || wizard.photoSlots.get(photo.slot) !== item) { sharedApi.revokePhoto(url); return; }
      item.url = url; item.privateUrl = true; item.status = 'ready';
      if (wizard.step === 5) renderAuditWizardScreen();
    }).catch(error => {
      if (state.auditWizard !== wizard || wizard.photoSlots.get(photo.slot) !== item) return;
      item.status = 'preview-error'; item.message = error.message;
      if (wizard.step === 5) renderAuditWizardScreen();
    });
  }
}

async function uploadPhotoSlot(wizard, slot, file) {
  const previous = wizard.photoSlots.get(slot);
  if (previous?.url?.startsWith('blob:')) previous.privateUrl ? sharedApi.revokePhoto(previous.url) : URL.revokeObjectURL(previous.url);
  const item = { status: 'uploading', file, descriptor: previous?.descriptor || null, controller: new AbortController() };
  wizard.photoSlots.set(slot, item);
  renderAuditWizardScreen();
  try {
    const blob = await normalizePhoto(file);
    if (state.auditWizard !== wizard || wizard.photoSlots.get(slot) !== item || item.cancelRequested) return;
    item.url = URL.createObjectURL(blob);
    const before = structuredClone(wizard.draft);
    const result = await sharedApi.putPhoto(wizard.draft.id, slot, blob, item.controller.signal);
    if (state.auditWizard !== wizard || wizard.photoSlots.get(slot) !== item || item.cancelRequested) return;
    mergePhotoDraft(wizard, before, result.draft);
    item.descriptor = result.draft.photos.find(photo => photo.slot === slot); item.status = 'ready';
  } catch (error) { if (state.auditWizard === wizard && wizard.photoSlots.get(slot) === item && !item.cancelRequested) { item.status = 'failed'; item.message = error.message; } }
  if (state.auditWizard === wizard && wizard.step === 5 && !item.cancelRequested) renderAuditWizardScreen();
}

async function removePhotoSlot(wizard, slot) {
  const item = wizard.photoSlots.get(slot); if (!item) return;
  if (item.status === 'removing') return;
  const wasUploading = item.status === 'uploading';
  if (wasUploading) { item.cancelRequested = true; item.controller?.abort(); }
  const reconcile = wasUploading || (item.status === 'failed' && Boolean(item.file));
  if (item.descriptor || reconcile) {
    item.status = 'removing'; renderAuditWizardScreen();
    try {
      if (reconcile) {
        const before = structuredClone(wizard.draft), refreshed = await sharedApi.refreshDraft(wizard.draft.id);
        if (state.auditWizard !== wizard || wizard.photoSlots.get(slot) !== item) return;
        mergePhotoDraft(wizard, before, refreshed.draft);
        item.descriptor = refreshed.draft.photos.find(photo => photo.slot === slot) || null;
      }
      if (item.descriptor || reconcile) {
        const before = structuredClone(wizard.draft), result = await sharedApi.deletePhoto(wizard.draft.id, slot);
        if (state.auditWizard !== wizard || wizard.photoSlots.get(slot) !== item) return;
        mergePhotoDraft(wizard, before, result.draft);
      }
    } catch (error) { item.status = 'failed'; item.message = error.message; renderAuditWizardScreen(); return; }
  }
  if (item.url?.startsWith('blob:')) item.privateUrl ? sharedApi.revokePhoto(item.url) : URL.revokeObjectURL(item.url);
  wizard.photoSlots.delete(slot);
  if (state.auditWizard === wizard && wizard.step === 5) renderAuditWizardScreen();
}

function renderSharedAuditReviewStep() {
  const wizard = state.auditWizard, worksheet = selectedWorksheet(), prompts = worksheet?.prompts || [];
  ensurePhotoSlots(wizard);
  const zoomed = document.body.classList.contains('text-zoomed');
  const section = wizard.reviewSection || 'details';
  const showDetails = !zoomed || section === 'details';
  const showEdits = !zoomed || section === 'edits';
  const showPhotos = !zoomed || wizard.reviewSection === 'photos';
  const scale = Math.max(1, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
  const reviewLimit = scale > 1.25 ? Math.max(20, Math.floor(60 / scale)) : 80;
  const pages = [
    ...splitDisplayText(`Location: ${wizard.draft.locationDescription || 'Not provided'}`, reviewLimit),
    ...prompts.flatMap(prompt => splitDisplayText(`${prompt.label} — ${answerDisplay(prompt, wizard.draft.answers?.[prompt.id])}`, reviewLimit))
  ];
  wizard.reviewPage = Math.max(0, Math.min(wizard.reviewPage || 0, pages.length - 1));
  appRoot.innerHTML = auditWizardFrame({ step: 5, title: 'Review your walk audit', content: `
    <div class="review-compact"><p><strong>${escapeHtml(studyTypeNames[wizard.draft.type])}</strong></p>
      ${showDetails ? `<div class="review-page"><p>${escapeHtml(pages[wizard.reviewPage])}</p><p class="help">Detail ${wizard.reviewPage + 1} of ${pages.length}</p></div>
      <div class="review-page-controls"><button class="button is-light" id="review-prev-detail" type="button" ${wizard.reviewPage ? '' : 'disabled'}>Previous detail</button><button class="button is-light" id="review-next-detail" type="button" ${wizard.reviewPage < pages.length - 1 ? '' : 'disabled'}>Next detail</button></div>` : ''}
      ${showEdits ? `<div class="review-edit-controls">${wizard.editingAuditId ? '' : '<button class="button is-light" data-edit-step="1" type="button">Change type</button>'}<button class="button is-light" data-edit-step="2" type="button">Edit location</button><button class="button is-light" data-edit-step="3" type="button">Edit description</button><button class="button is-light" data-edit-step="4" type="button">Edit answers</button></div>` : ''}
      ${showPhotos ? `<div class="photo-heading"><strong>Photos</strong> <span class="help">Optional · up to three</span></div>
      <div class="photo-slots">${[1, 2, 3].map(slot => {
        const photo = wizard.photoSlots.get(slot);
        return `<div class="photo-slot">${photo?.url ? `<img src="${escapeHtml(photo.url)}" alt="Photo ${slot} preview">` : `<span class="photo-placeholder">${photo ? escapeHtml(photo.status === 'uploading' ? 'Uploading…' : photo.status === 'loading' ? 'Loading…' : photo.status === 'removing' ? 'Removing…' : 'Photo unavailable') : `Photo ${slot}`}</span>`}
          ${wizard.editingAuditId ? '' : photo ? `<div class="photo-slot-actions">${photo.status === 'failed' && photo.file ? `<button class="button is-light" data-retry-photo="${slot}" type="button">Retry</button>` : ''}<button class="button is-light" data-remove-photo="${slot}" type="button" ${photo.status === 'removing' ? 'disabled' : ''}>Remove</button></div>` : `<label class="button is-light photo-add">Add<input type="file" data-photo-slot="${slot}" accept="image/jpeg,image/png,image/webp" hidden></label>`}
          ${photo?.message ? '<span class="photo-error">Photo needs attention</span>' : ''}</div>`;
      }).join('')}</div>` : ''}
      ${zoomed ? `<div class="review-section-controls">${section !== 'details' ? '<button class="button is-light" data-review-section="details" type="button">Details</button>' : ''}${section !== 'edits' ? '<button class="button is-light" data-review-section="edits" type="button">Edit sections</button>' : ''}${section !== 'photos' ? '<button class="button is-light" data-review-section="photos" type="button">Photos</button>' : ''}</div>` : ''}</div>
    <div id="review-error" class="error-notice" hidden></div><div class="wizard-actions"><button class="button is-light" id="review-back" type="button">Back</button><button class="button is-primary" id="submit-final-audit" type="button">${wizard.editingAuditId ? 'Save audit' : 'Submit audit'}</button></div>` });
  document.querySelectorAll('[data-edit-step]').forEach(button => button.addEventListener('click', () => { wizard.step = Number(button.dataset.editStep); if (wizard.step === 4) { wizard.questionIndex = 0; wizard.contentKey = null; } renderAuditWizardScreen(); }));
  document.querySelector('#review-prev-detail')?.addEventListener('click', () => { wizard.reviewPage--; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#review-prev-detail', '#review-next-detail')); });
  document.querySelector('#review-next-detail')?.addEventListener('click', () => { wizard.reviewPage++; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus('#review-next-detail', '#review-prev-detail')); });
  document.querySelectorAll('[data-review-section]').forEach(button => button.addEventListener('click', () => { wizard.reviewSection = button.dataset.reviewSection; Promise.resolve(renderAuditWizardScreen()).then(() => restorePagerFocus(`[data-review-section="${section}"]`, '#submit-final-audit')); }));
  document.querySelector('#review-back').addEventListener('click', () => { wizard.step = 4; wizard.questionIndex = Math.max(prompts.length - 1, 0); wizard.contentKey = null; renderAuditWizardScreen(); });
  document.querySelector('#submit-final-audit').addEventListener('click', submitAuditWizard);
  document.querySelectorAll('[data-photo-slot]').forEach(input => input.addEventListener('change', () => { if (input.files?.[0]) uploadPhotoSlot(wizard, Number(input.dataset.photoSlot), input.files[0]); }));
  document.querySelectorAll('[data-remove-photo]').forEach(button => button.addEventListener('click', () => removePhotoSlot(wizard, Number(button.dataset.removePhoto))));
  document.querySelectorAll('[data-retry-photo]').forEach(button => button.addEventListener('click', () => { const slot = Number(button.dataset.retryPhoto), item = wizard.photoSlots.get(slot); if (item?.file) uploadPhotoSlot(wizard, slot, item.file); }));
  const photoIssue = [...wizard.photoSlots.values()].find(photo => photo.message);
  if (photoIssue) showBoundedError(document.querySelector('#review-error'), photoIssue.message);
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
  if (sharedApi) {
    if ([...(wizard.photoSlots?.values() || [])].some(photo => ['uploading', 'removing', 'failed'].includes(photo.status))) {
      showBoundedError(errorBox, 'Wait for photo uploads to finish, or retry or remove failed photos.'); button.classList.remove('is-loading'); return;
    }
    button.disabled = true;
    try {
      await persistAuditDraft({ answers: structuredClone(wizard.draft.answers || {}) });
      await api(`/api/drafts/${wizard.draft.id}/submit`, { method: 'POST', body: {} });
      privateDraftCache.delete(wizard.cacheKey);
      clearAuditWizard();
      navigate(`/studies/${wizard.studyId}?${wizard.editingAuditId ? 'saved' : 'submitted'}=1`, { replace: true });
    } catch (error) {
      showBoundedError(errorBox, error.message);
      button.classList.remove('is-loading');
      button.disabled = false;
    }
    return;
  }
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
        <div class="detail-item"><span class="detail-item-label">Type</span><strong>${escapeHtml(studyTypeNames[audit.type] || audit.type)}</strong></div>
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
    ${audit.photos?.length ? `<div class="panel-card mt-4"><h2 class="title is-4">Photos</h2><div class="audit-photo-gallery">${audit.photos.map(photo => `<a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(photo.url)}" alt="Audit photo ${photo.slot}"></a>`).join('')}</div></div>` : ''}

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
