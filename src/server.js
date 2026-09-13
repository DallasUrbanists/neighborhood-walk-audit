import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { createRepository, MemoryRepository } from './repository.js';
import { describeStudyArea, queryStreetNetwork, validateStudyArea } from './geospatial.js';
import { createStudyThumbnail } from './thumbnail.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = path.join(root, 'public');
const app = express();
const port = Number(process.env.PORT || 3000);
const cookieSecret = process.env.COOKIE_SECRET || 'local-development-only-secret-change-me';
const cartoTileVersion = crypto
  .createHash('sha256')
  .update(process.env.CARTO_API_KEY || 'no-carto-key')
  .digest('hex')
  .slice(0, 12);

let repository = await createRepository();

if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
      connectSrc: ["'self'", 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
      fontSrc: ["'self'", 'data:'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cookieParser(cookieSecret));
app.use(express.json({ limit: '2mb' }));

app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules', 'leaflet', 'dist'), {
  immutable: true,
  maxAge: '30d'
}));
app.get('/vendor/bulma/bulma.min.css', (request, response) => {
  response.sendFile(path.join(root, 'node_modules', 'bulma', 'css', 'bulma.min.css'));
});
app.use(express.static(publicDirectory, {
  maxAge: '1h',
  etag: true,
  setHeaders(response, filePath) {
    if (['app.js', 'index.html', 'service-worker.js'].includes(path.basename(filePath))) {
      response.setHeader('cache-control', 'no-cache');
    }
  }
}));

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

function normalizeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 100) throw new HttpError(400, 'Enter your name.');
  return name;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function currentUser(request) {
  const id = Number(request.signedCookies.walk_audit_user);
  if (!Number.isInteger(id) || id < 1) return null;
  return repository.getUser(id);
}

async function requireUser(request, _response, next) {
  try {
    const user = await currentUser(request);
    if (!user) throw new HttpError(401, 'Enter your email to continue.');
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function setUserCookie(response, user) {
  response.cookie('walk_audit_user', String(user.id), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 365
  });
}

function featureId(audit) {
  return audit.geojson?.properties?.id || null;
}

function calculateProgress(study, audits) {
  const auditedSegments = new Set(
    audits.filter((audit) => audit.type === 'street-segment').map(featureId).filter(Boolean)
  );
  const auditedIntersections = new Set(
    audits.filter((audit) => audit.type === 'intersection').map(featureId).filter(Boolean)
  );
  const totalSegments = study.segments?.features?.length || 0;
  const totalIntersections = study.intersections?.features?.length || 0;
  const segmentCount = Math.min(auditedSegments.size, totalSegments);
  const intersectionCount = Math.min(auditedIntersections.size, totalIntersections);
  return {
    streets: {
      audited: segmentCount,
      total: totalSegments,
      ratio: totalSegments ? segmentCount / totalSegments : 0
    },
    intersections: {
      audited: intersectionCount,
      total: totalIntersections,
      ratio: totalIntersections ? intersectionCount / totalIntersections : 0
    }
  };
}

function reportDescription(study, audits, progress) {
  const priorities = audits.map((audit) => audit.answers?.priority).filter(Boolean);
  const urgent = priorities.filter((value) => value === 'high' || value === 'immediate').length;
  const completedLocations = progress.streets.audited + progress.intersections.audited;
  const totalLocations = progress.streets.total + progress.intersections.total;
  const overall = totalLocations ? Math.round((completedLocations / totalLocations) * 100) : 0;
  if (!audits.length) {
    return `${study.neighborhood} has not received any walk audits yet. This snapshot records 0% location coverage and can serve as a baseline before volunteer observations begin.`;
  }
  const lastAudit = [...audits].sort((a, b) => b.createdOn.localeCompare(a.createdOn))[0];
  return `${study.neighborhood} has ${audits.length} submitted walk ${audits.length === 1 ? 'audit' : 'audits'}, covering ${overall}% of mapped street segments and intersections. Volunteers have audited ${progress.streets.audited} of ${progress.streets.total} street segments and ${progress.intersections.audited} of ${progress.intersections.total} intersections. ${urgent ? `${urgent} ${urgent === 1 ? 'submission identifies' : 'submissions identify'} a high or immediate-priority concern.` : 'No submission currently identifies a high or immediate-priority concern.'} The most recent observation was recorded for ${lastAudit.locationDescription}.`;
}

async function generateReportDescription(study, audits, progress) {
  const fallback = reportDescription(study, audits, progress);
  if (!process.env.REPORT_AI_ENDPOINT) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(process.env.REPORT_AI_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(process.env.REPORT_AI_TOKEN ? { authorization: `Bearer ${process.env.REPORT_AI_TOKEN}` } : {})
      },
      body: JSON.stringify({
        instruction: 'Write a factual, plain-language summary of this neighborhood walk-audit snapshot. Do not invent findings. Mention coverage and recurring strengths or concerns evident in the answers.',
        study: { id: study.id, neighborhood: study.neighborhood, createdOn: study.createdOn },
        progress,
        audits: audits.map((audit) => ({
          id: audit.id,
          type: audit.type,
          locationDescription: audit.locationDescription,
          createdOn: audit.createdOn,
          worksheetTitle: audit.worksheetTitle,
          answers: audit.answers
        })),
        fallback
      })
    });
    if (!response.ok) throw new Error(`report endpoint returned ${response.status}`);
    const result = await response.json();
    const description = String(result.description || '').trim();
    if (description.length < 20 || description.length > 12_000) throw new Error('report endpoint returned an invalid description');
    return description;
  } catch (error) {
    console.warn(`AI report generation was unavailable; using the built-in summary. ${error.message}`);
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/config', (_request, response) => {
  response.json({
    demoMode: !process.env.DATABASE_URL || process.env.DEMO_MODE === 'true',
    appOrigin: process.env.APP_ORIGIN || null,
    cartoTileVersion
  });
});

const CARTO_STYLES = new Set(['light_all', 'dark_all']);

app.get('/api/tiles/carto/:style/:z/:x/:y.png', async (request, response, next) => {
  try {
    const { style, z, x, y } = request.params;
    if (!CARTO_STYLES.has(style) || ![z, x, y].every((value) => /^\d+$/.test(value))) {
      throw new HttpError(400, 'Invalid map tile request.');
    }

    const cartoUrl = new URL(`https://basemaps.cartocdn.com/rastertiles/${style}/${z}/${x}/${y}.png`);
    if (process.env.CARTO_API_KEY) cartoUrl.searchParams.set('key', process.env.CARTO_API_KEY);
    const cartoResponse = await fetch(cartoUrl);
    if (!cartoResponse.ok) throw new HttpError(502, `CARTO map tile request returned ${cartoResponse.status}.`);

    const contentType = cartoResponse.headers.get('content-type') || 'image/png';
    response.set({
      'content-type': contentType,
      'cache-control': 'public, max-age=86400'
    });
    response.send(Buffer.from(await cartoResponse.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});

app.get('/api/session', async (request, response, next) => {
  try {
    response.json({ user: await currentUser(request) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/session', async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body.email);
    let user = await repository.findUserByEmail(email);
    if (!user && !request.body.name) {
      return response.status(200).json({ needsName: true, email });
    }
    if (!user) user = await repository.createUser({ email, name: normalizeName(request.body.name) });
    setUserCookie(response, user);
    return response.json({ needsName: false, user });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/session', (request, response) => {
  response.clearCookie('walk_audit_user');
  response.status(204).end();
});

app.get('/api/dashboard', requireUser, async (request, response, next) => {
  try {
    response.json({
      user: request.user,
      studies: await repository.listStudySummaries(request.user.id)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/studies', requireUser, async (request, response, next) => {
  try {
    const neighborhood = String(request.body.neighborhood || '').trim().replace(/\s+/g, ' ');
    if (!neighborhood || neighborhood.length > 160) {
      throw new HttpError(400, 'Enter a neighborhood name.');
    }
    const area = validateStudyArea(request.body.area);
    const location = describeStudyArea(neighborhood, area);
    const network = await queryStreetNetwork(area);
    const thumbnailPng = createStudyThumbnail(area, network.segments);
    const study = await repository.createStudy({
      neighborhood,
      createdBy: request.user.id,
      ...location,
      area,
      ...network,
      thumbnailPath: null,
      thumbnailPng
    });
    response.status(201).json({ study });
  } catch (error) {
    next(error);
  }
});

app.get('/api/studies/:studyId', async (request, response, next) => {
  try {
    const study = await repository.getStudy(request.params.studyId);
    if (!study) throw new HttpError(404, 'Study not found.');
    const audits = await repository.listAudits(study.id);
    const user = await currentUser(request);
    response.json({
      study,
      audits,
      progress: calculateProgress(study, audits),
      permissions: {
        isOrganizer: user?.id === study.createdBy,
        canContribute: Boolean(user)
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/studies/:studyId/thumbnail', async (request, response, next) => {
  try {
    const study = await repository.getStudy(request.params.studyId);
    if (!study) throw new HttpError(404, 'Study not found.');
    const png = await repository.getStudyThumbnail(study.id) || createStudyThumbnail(study.area, study.segments);
    response.set({ 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    response.send(png);
  } catch (error) {
    next(error);
  }
});

app.get('/api/worksheets', async (request, response, next) => {
  try {
    const type = request.query.type;
    if (type && !['intersection', 'street-segment'].includes(type)) {
      throw new HttpError(400, 'Unknown audit type.');
    }
    response.json({ worksheets: await repository.listWorksheets(type) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/studies/:studyId/drafts', requireUser, async (request, response, next) => {
  try {
    const study = await repository.getStudy(request.params.studyId);
    if (!study) throw new HttpError(404, 'Study not found.');
    const editingAuditId = request.body.editingAuditId ? Number(request.body.editingAuditId) : null;
    const draft = await repository.createDraft({
      studyId: study.id,
      userId: request.user.id,
      editingAuditId
    });
    response.status(201).json({ draft });
  } catch (error) {
    next(error);
  }
});

app.get('/api/drafts/:draftId', requireUser, async (request, response, next) => {
  try {
    const draft = await repository.getDraft(request.params.draftId, request.user.id);
    if (!draft) throw new HttpError(404, 'Draft not found.');
    response.json({ draft });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/drafts/:draftId', requireUser, async (request, response, next) => {
  try {
    const allowed = ['type', 'worksheetId', 'locationGps', 'locationDescription', 'geojson', 'answers'];
    const updates = Object.fromEntries(Object.entries(request.body).filter(([key]) => allowed.includes(key)));
    if (updates.type && !['intersection', 'street-segment'].includes(updates.type)) {
      throw new HttpError(400, 'Unknown audit type.');
    }
    if (updates.locationDescription && String(updates.locationDescription).length > 500) {
      throw new HttpError(400, 'Location description must be 500 characters or less.');
    }
    if (JSON.stringify(updates.answers || {}).length > 100_000) {
      throw new HttpError(400, 'Worksheet answers are too large.');
    }
    const draft = await repository.updateDraft(request.params.draftId, request.user.id, updates);
    if (!draft) throw new HttpError(404, 'Draft not found.');
    response.json({ draft });
  } catch (error) {
    next(error);
  }
});

app.post('/api/drafts/:draftId/submit', requireUser, async (request, response, next) => {
  try {
    const audit = await repository.submitDraft(request.params.draftId, request.user.id);
    response.status(request.body.editing ? 200 : 201).json({ audit });
  } catch (error) {
    next(error);
  }
});

app.get('/api/audits/:auditId', async (request, response, next) => {
  try {
    const audit = await repository.getAudit(request.params.auditId);
    if (!audit) throw new HttpError(404, 'Audit not found.');
    const study = await repository.getStudy(audit.studyId);
    const user = await currentUser(request);
    response.json({ audit, study, permissions: { canEdit: user?.id === audit.createdBy } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/studies/:studyId/reports', async (request, response, next) => {
  try {
    const study = await repository.getStudy(request.params.studyId);
    if (!study) throw new HttpError(404, 'Study not found.');
    response.json({ reports: await repository.listReports(study.id) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/studies/:studyId/reports', requireUser, async (request, response, next) => {
  try {
    const study = await repository.getStudy(request.params.studyId);
    if (!study) throw new HttpError(404, 'Study not found.');
    if (study.createdBy !== request.user.id) throw new HttpError(403, 'Only the study organizer can generate a report.');
    const audits = await repository.listAudits(study.id);
    const progress = calculateProgress(study, audits);
    const total = progress.streets.total + progress.intersections.total;
    const completed = progress.streets.audited + progress.intersections.audited;
    const report = await repository.createReport({
      studyId: study.id,
      audits: audits.map((audit) => audit.id),
      completion: total ? completed / total : 0,
      description: await generateReportDescription(study, audits, progress)
    });
    response.status(201).json({ report });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, _response, next) => next(new HttpError(404, 'That request was not found.')));

app.use((request, response, next) => {
  if (request.method !== 'GET' || !request.accepts('html')) return next();
  response.sendFile(path.join(publicDirectory, 'index.html'));
});

app.use((error, _request, response, _next) => {
  const known = error instanceof HttpError || error.message?.includes('OpenStreetMap') || error.message?.includes('Draft');
  const status = error.status || (known ? 400 : 500);
  if (status >= 500) console.error(error);
  response.status(status).json({ error: error.message || 'Something went wrong. Please try again.' });
});

try {
  await repository.init();
} catch (error) {
  console.warn(`Repository initialization failed; restarting with the in-memory demo repository. ${error.message}`);
  process.env.DEMO_MODE = 'true';
  repository = new MemoryRepository({ seedDemo: process.env.NODE_ENV !== 'test' });
  await repository.init();
}

const server = app.listen(port, () => {
  console.log(`Neighborhood Walk Audit listening on http://localhost:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await repository.close();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, repository, calculateProgress };
