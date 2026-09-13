import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const port = 31873;
const origin = `http://127.0.0.1:${port}`;

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start in time.')), 8000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Neighborhood Walk Audit listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      const message = String(chunk);
      if (message.includes('Error')) {
        clearTimeout(timeout);
        reject(new Error(message));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}.`));
    });
  });
}

test('falls back to demo repository when PostgreSQL is unavailable', async (context) => {
  const fallbackPort = 31874;
  const fallbackOrigin = `http://127.0.0.1:${fallbackPort}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(fallbackPort), DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/walk_audit', DEMO_MODE: 'false', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  context.after(() => child.kill('SIGTERM'));

  await waitForServer(child);

  const config = await fetch(`${fallbackOrigin}/api/config`);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).demoMode, true);

  child.kill('SIGTERM');
});

test('serves the app and completes an audit through the API', async (context) => {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', DEMO_MODE: 'true', NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  context.after(() => child.kill('SIGTERM'));
  await waitForServer(child);

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const page = await fetch(origin);
  assert.match(await page.text(), /Neighborhood Walk Audit/);

  const login = await fetch(`${origin}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'organizer@example.com' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const dashboard = await fetch(`${origin}/api/dashboard`, { headers: { cookie } });
  const dashboardData = await dashboard.json();
  assert.equal(dashboardData.studies.length, 1);

  const studyResponse = await fetch(`${origin}/api/studies/1`);
  const studyData = await studyResponse.json();
  assert.equal(studyData.study.neighborhood, 'Sample Neighborhood');

  const worksheetResponse = await fetch(`${origin}/api/worksheets?type=intersection`);
  const worksheets = (await worksheetResponse.json()).worksheets;
  assert.ok(worksheets.length >= 2);

  const draftResponse = await fetch(`${origin}/api/studies/1/drafts`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}'
  });
  const draft = (await draftResponse.json()).draft;
  const intersection = studyData.study.intersections.features[0];
  const savedResponse = await fetch(`${origin}/api/drafts/${draft.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'intersection',
      worksheetId: worksheets[0].id,
      locationGps: { latitude: intersection.geometry.coordinates[1], longitude: intersection.geometry.coordinates[0] },
      locationDescription: intersection.properties.description,
      geojson: intersection,
      answers: { priority: 'medium' }
    })
  });
  assert.equal(savedResponse.status, 200);

  const submitResponse = await fetch(`${origin}/api/drafts/${draft.id}/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}'
  });
  assert.equal(submitResponse.status, 201);
  const audit = (await submitResponse.json()).audit;

  const auditResponse = await fetch(`${origin}/api/audits/${audit.id}`, { headers: { cookie } });
  const auditData = await auditResponse.json();
  assert.equal(auditData.audit.answers.priority, 'medium');
  assert.equal(auditData.permissions.canEdit, true);

  const reportResponse = await fetch(`${origin}/api/studies/1/reports`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}'
  });
  assert.equal(reportResponse.status, 201);
  const report = (await reportResponse.json()).report;
  assert.match(report.description, /Sample Neighborhood/);

  const thumbnail = await fetch(`${origin}/api/studies/1/thumbnail`);
  const bytes = new Uint8Array(await thumbnail.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
