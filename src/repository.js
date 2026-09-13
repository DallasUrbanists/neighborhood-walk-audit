import crypto from 'node:crypto';
import pg from 'pg';
import { worksheetSeeds } from './worksheets.js';

const { Pool } = pg;

const asDate = (value) => value instanceof Date ? value.toISOString() : value;
const parseJson = (value) => typeof value === 'string' ? JSON.parse(value) : value;

function userFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    createdOn: asDate(row.created_on)
  };
}

function worksheetFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
    sourceUrl: row.source_url,
    recommendFor: row.recommend_for,
    prompts: parseJson(row.prompts)
  };
}

function studyFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    neighborhood: row.neighborhood,
    createdOn: asDate(row.created_on),
    createdBy: Number(row.created_by),
    creatorName: row.creator_name,
    locationGps: parseJson(row.location_gps),
    locationDescription: row.location_description,
    area: parseJson(row.area),
    intersections: parseJson(row.intersections),
    segments: parseJson(row.segments),
    thumbnailPath: row.thumbnail_path || `/api/studies/${row.id}/thumbnail`,
    lastAudit: asDate(row.last_audit),
    auditCount: Number(row.audit_count || 0)
  };
}

function auditFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    studyId: Number(row.study_id),
    createdOn: asDate(row.created_on),
    updatedOn: asDate(row.updated_on),
    createdBy: Number(row.created_by),
    contributorName: row.contributor_name,
    type: row.type,
    worksheetId: Number(row.worksheet_id),
    worksheetTitle: row.worksheet_title,
    worksheetPrompts: parseJson(row.worksheet_prompts),
    locationGps: parseJson(row.location_gps),
    locationDescription: row.location_description,
    geojson: parseJson(row.geojson),
    answers: parseJson(row.answers) || {}
  };
}

function draftFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    studyId: Number(row.study_id),
    createdBy: Number(row.created_by),
    editingAuditId: row.editing_audit_id ? Number(row.editing_audit_id) : null,
    type: row.type,
    worksheetId: row.worksheet_id ? Number(row.worksheet_id) : null,
    locationGps: parseJson(row.location_gps),
    locationDescription: row.location_description,
    geojson: parseJson(row.geojson),
    answers: parseJson(row.answers) || {},
    updatedOn: asDate(row.updated_on)
  };
}

function reportFromRow(row) {
  return {
    id: Number(row.id),
    studyId: Number(row.study_id),
    createdOn: asDate(row.created_on),
    audits: (row.audits || []).map(Number),
    completion: Number(row.completion),
    description: row.description
  };
}

export class PostgresRepository {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
    });
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }

  async init() {
    for (const worksheet of worksheetSeeds) {
      await this.pool.query(
        `INSERT INTO worksheets (slug, title, description, source_url, recommend_for, prompts)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           source_url = EXCLUDED.source_url,
           recommend_for = EXCLUDED.recommend_for,
           prompts = EXCLUDED.prompts`,
        [
          worksheet.slug,
          worksheet.title,
          worksheet.description,
          worksheet.sourceUrl,
          worksheet.recommendFor,
          JSON.stringify(worksheet.prompts)
        ]
      );
    }
  }

  async close() {
    await this.pool.end();
  }

  async findUserByEmail(email) {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return userFromRow(result.rows[0]);
  }

  async getUser(id) {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return userFromRow(result.rows[0]);
  }

  async createUser({ name, email }) {
    const result = await this.pool.query(
      `INSERT INTO users (name, email) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING *`,
      [name.trim(), email.toLowerCase()]
    );
    return userFromRow(result.rows[0]);
  }

  async createStudy(data) {
    const result = await this.pool.query(
      `INSERT INTO studies (
         neighborhood, created_by, location_gps, location_description, area,
         intersections, segments, thumbnail_path, thumbnail_png
       ) VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
       RETURNING *`,
      [
        data.neighborhood,
        data.createdBy,
        JSON.stringify(data.locationGps),
        data.locationDescription,
        JSON.stringify(data.area),
        JSON.stringify(data.intersections),
        JSON.stringify(data.segments),
        data.thumbnailPath,
        data.thumbnailPng
      ]
    );
    const row = result.rows[0];
    if (!row.thumbnail_path) {
      const thumbnailPath = `/api/studies/${row.id}/thumbnail`;
      const updated = await this.pool.query(
        'UPDATE studies SET thumbnail_path = $1 WHERE id = $2 RETURNING *',
        [thumbnailPath, row.id]
      );
      return studyFromRow(updated.rows[0]);
    }
    return studyFromRow(row);
  }

  async listStudySummaries(userId) {
    const result = await this.pool.query(
      `SELECT s.*,
              u.name AS creator_name,
              COUNT(a.id)::int AS audit_count,
              MAX(a.created_on) AS last_audit
       FROM studies s
       JOIN users u ON u.id = s.created_by
       LEFT JOIN audits a ON a.study_id = s.id
       WHERE s.created_by = $1
          OR EXISTS (SELECT 1 FROM audits mine WHERE mine.study_id = s.id AND mine.created_by = $1)
       GROUP BY s.id, u.name
       ORDER BY COALESCE(MAX(a.created_on), s.created_on) DESC`,
      [userId]
    );
    return result.rows.map(studyFromRow);
  }

  async getStudy(id) {
    const result = await this.pool.query(
      `SELECT s.*, u.name AS creator_name, COUNT(a.id)::int AS audit_count, MAX(a.created_on) AS last_audit
       FROM studies s
       JOIN users u ON u.id = s.created_by
       LEFT JOIN audits a ON a.study_id = s.id
       WHERE s.id = $1
       GROUP BY s.id, u.name`,
      [id]
    );
    return studyFromRow(result.rows[0]);
  }

  async getStudyThumbnail(id) {
    const result = await this.pool.query('SELECT thumbnail_png FROM studies WHERE id = $1', [id]);
    return result.rows[0]?.thumbnail_png || null;
  }

  async listWorksheets(type) {
    const result = type
      ? await this.pool.query('SELECT * FROM worksheets WHERE $1 = ANY(recommend_for) ORDER BY title', [type])
      : await this.pool.query('SELECT * FROM worksheets ORDER BY title');
    return result.rows.map(worksheetFromRow);
  }

  async getWorksheet(id) {
    const result = await this.pool.query('SELECT * FROM worksheets WHERE id = $1', [id]);
    return worksheetFromRow(result.rows[0]);
  }

  async listAudits(studyId) {
    const result = await this.pool.query(
      `SELECT a.*, u.name AS contributor_name, w.title AS worksheet_title, w.prompts AS worksheet_prompts
       FROM audits a
       JOIN users u ON u.id = a.created_by
       JOIN worksheets w ON w.id = a.worksheet_id
       WHERE a.study_id = $1
       ORDER BY a.created_on DESC`,
      [studyId]
    );
    return result.rows.map(auditFromRow);
  }

  async getAudit(id) {
    const result = await this.pool.query(
      `SELECT a.*, u.name AS contributor_name, w.title AS worksheet_title, w.prompts AS worksheet_prompts
       FROM audits a
       JOIN users u ON u.id = a.created_by
       JOIN worksheets w ON w.id = a.worksheet_id
       WHERE a.id = $1`,
      [id]
    );
    return auditFromRow(result.rows[0]);
  }

  async createDraft({ studyId, userId, editingAuditId = null }) {
    const id = crypto.randomUUID();
    let seed = {};
    if (editingAuditId) {
      const audit = await this.getAudit(editingAuditId);
      if (!audit || audit.studyId !== Number(studyId)) throw new Error('Audit not found.');
      if (audit.createdBy !== Number(userId)) throw new Error('You can only edit audits you submitted.');
      seed = audit;
    }
    const result = await this.pool.query(
      `INSERT INTO audit_drafts (
         id, study_id, created_by, editing_audit_id, type, worksheet_id,
         location_gps, location_description, geojson, answers
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb)
       RETURNING *`,
      [
        id,
        studyId,
        userId,
        editingAuditId,
        seed.type || null,
        seed.worksheetId || null,
        seed.locationGps ? JSON.stringify(seed.locationGps) : null,
        seed.locationDescription || null,
        seed.geojson ? JSON.stringify(seed.geojson) : null,
        JSON.stringify(seed.answers || {})
      ]
    );
    return draftFromRow(result.rows[0]);
  }

  async getDraft(id, userId) {
    const result = await this.pool.query(
      'SELECT * FROM audit_drafts WHERE id = $1 AND created_by = $2',
      [id, userId]
    );
    return draftFromRow(result.rows[0]);
  }

  async updateDraft(id, userId, updates) {
    const columns = {
      type: 'type',
      worksheetId: 'worksheet_id',
      locationGps: 'location_gps',
      locationDescription: 'location_description',
      geojson: 'geojson',
      answers: 'answers'
    };
    const values = [];
    const setters = [];
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in updates)) continue;
      values.push(['locationGps', 'geojson', 'answers'].includes(key) && updates[key] !== null
        ? JSON.stringify(updates[key])
        : updates[key]);
      setters.push(`${column} = $${values.length}${['locationGps', 'geojson', 'answers'].includes(key) ? '::jsonb' : ''}`);
    }
    if (!setters.length) return this.getDraft(id, userId);
    values.push(id, userId);
    const result = await this.pool.query(
      `UPDATE audit_drafts
       SET ${setters.join(', ')}, updated_on = NOW()
       WHERE id = $${values.length - 1} AND created_by = $${values.length}
       RETURNING *`,
      values
    );
    return draftFromRow(result.rows[0]);
  }

  async submitDraft(id, userId) {
    const client = await this.pool.connect();
    let auditId;
    try {
      await client.query('BEGIN');
      const draftResult = await client.query(
        'SELECT * FROM audit_drafts WHERE id = $1 AND created_by = $2 FOR UPDATE',
        [id, userId]
      );
      const draft = draftResult.rows[0];
      if (!draft) throw new Error('Draft not found.');
      if (!draft.type || !draft.worksheet_id || !draft.location_gps || !draft.location_description || !draft.geojson) {
        throw new Error('Complete the audit type, location, description, and worksheet before submitting.');
      }
      if (draft.editing_audit_id) {
        const result = await client.query(
          `UPDATE audits SET
             type = $1, worksheet_id = $2, location_gps = $3, location_description = $4,
             geojson = $5, answers = $6, updated_on = NOW()
           WHERE id = $7 AND created_by = $8
           RETURNING id`,
          [draft.type, draft.worksheet_id, draft.location_gps, draft.location_description,
            draft.geojson, draft.answers, draft.editing_audit_id, userId]
        );
        if (!result.rowCount) throw new Error('Audit not found or cannot be edited.');
        auditId = result.rows[0].id;
      } else {
        const result = await client.query(
          `INSERT INTO audits (
             study_id, created_by, type, worksheet_id, location_gps,
             location_description, geojson, answers
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [draft.study_id, userId, draft.type, draft.worksheet_id, draft.location_gps,
            draft.location_description, draft.geojson, draft.answers]
        );
        auditId = result.rows[0].id;
      }
      await client.query('DELETE FROM audit_drafts WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.getAudit(auditId);
  }

  async listReports(studyId) {
    const result = await this.pool.query(
      'SELECT * FROM reports WHERE study_id = $1 ORDER BY created_on DESC',
      [studyId]
    );
    return result.rows.map(reportFromRow);
  }

  async createReport({ studyId, audits, completion, description }) {
    const result = await this.pool.query(
      `INSERT INTO reports (study_id, audits, completion, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [studyId, audits, completion, description]
    );
    return reportFromRow(result.rows[0]);
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class MemoryRepository {
  constructor({ seedDemo = false } = {}) {
    this.users = [];
    this.studies = [];
    this.audits = [];
    this.drafts = [];
    this.reports = [];
    this.worksheets = worksheetSeeds.map((worksheet, index) => ({ ...clone(worksheet), id: index + 1 }));
    this.ids = { user: 1, study: 1, audit: 1, report: 1 };
    if (seedDemo) this.seedDemo();
  }

  async init() {}
  async close() {}

  seedDemo() {
    const user = {
      id: this.ids.user++,
      name: 'Sample Organizer',
      email: 'organizer@example.com',
      createdOn: new Date('2026-09-01T15:00:00Z').toISOString()
    };
    this.users.push(user);
    const points = {
      nw: [-96.8076, 32.7798], ne: [-96.7994, 32.7798],
      sw: [-96.8076, 32.7734], se: [-96.7994, 32.7734],
      c: [-96.8035, 32.7766]
    };
    const area = {
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[points.nw, points.ne, points.se, points.sw, points.nw]] }
    };
    const intersections = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'intersection-demo-center', streetNames: ['Akard Street', 'Cadiz Street'], description: 'Intersection of Akard Street and Cadiz Street' }, geometry: { type: 'Point', coordinates: points.c } },
        { type: 'Feature', properties: { id: 'intersection-demo-north', streetNames: ['Akard Street', 'Young Street'], description: 'Intersection of Akard Street and Young Street' }, geometry: { type: 'Point', coordinates: [-96.8035, 32.7798] } },
        { type: 'Feature', properties: { id: 'intersection-demo-east', streetNames: ['Cadiz Street', 'Griffin Street'], description: 'Intersection of Cadiz Street and Griffin Street' }, geometry: { type: 'Point', coordinates: [-96.7994, 32.7766] } }
      ]
    };
    const segments = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'segment-demo-1', name: 'Akard Street', description: 'Segment of Akard Street between Young Street and Cadiz Street' }, geometry: { type: 'LineString', coordinates: [[-96.8035, 32.7798], points.c] } },
        { type: 'Feature', properties: { id: 'segment-demo-2', name: 'Akard Street', description: 'Segment of Akard Street south of Cadiz Street' }, geometry: { type: 'LineString', coordinates: [points.c, [-96.8035, 32.7734]] } },
        { type: 'Feature', properties: { id: 'segment-demo-3', name: 'Cadiz Street', description: 'Segment of Cadiz Street between Akard Street and Griffin Street' }, geometry: { type: 'LineString', coordinates: [points.c, [-96.7994, 32.7766]] } },
        { type: 'Feature', properties: { id: 'segment-demo-4', name: 'Cadiz Street', description: 'Segment of Cadiz Street west of Akard Street' }, geometry: { type: 'LineString', coordinates: [[-96.8076, 32.7766], points.c] } }
      ]
    };
    this.studies.push({
      id: this.ids.study++,
      neighborhood: 'Sample Neighborhood',
      createdOn: new Date('2026-09-01T15:00:00Z').toISOString(),
      createdBy: user.id,
      creatorName: user.name,
      locationGps: { latitude: 32.7766, longitude: -96.8035 },
      locationDescription: 'Sample Neighborhood study area centered near 32.77660, -96.80350',
      area,
      intersections,
      segments,
      thumbnailPath: '/api/studies/1/thumbnail',
      thumbnailPng: null
    });
  }

  async findUserByEmail(email) {
    return clone(this.users.find((user) => user.email === email.toLowerCase()) || null);
  }

  async getUser(id) {
    return clone(this.users.find((user) => user.id === Number(id)) || null);
  }

  async createUser({ name, email }) {
    const existing = await this.findUserByEmail(email);
    if (existing) return existing;
    const user = { id: this.ids.user++, name: name.trim(), email: email.toLowerCase(), createdOn: new Date().toISOString() };
    this.users.push(user);
    return clone(user);
  }

  async createStudy(data) {
    const creator = await this.getUser(data.createdBy);
    const thumbnailPng = data.thumbnailPng ? Buffer.from(data.thumbnailPng) : null;
    const study = {
      ...clone(data),
      id: this.ids.study++,
      createdOn: new Date().toISOString(),
      creatorName: creator?.name,
      thumbnailPath: null,
      lastAudit: null,
      auditCount: 0
    };
    study.thumbnailPng = thumbnailPng;
    study.thumbnailPath = `/api/studies/${study.id}/thumbnail`;
    this.studies.push(study);
    return clone(study);
  }

  async listStudySummaries(userId) {
    return clone(this.studies
      .filter((study) => study.createdBy === Number(userId) || this.audits.some((audit) => audit.studyId === study.id && audit.createdBy === Number(userId)))
      .map((study) => {
        const audits = this.audits.filter((audit) => audit.studyId === study.id);
        return {
          ...study,
          auditCount: audits.length,
          lastAudit: audits.sort((a, b) => b.createdOn.localeCompare(a.createdOn))[0]?.createdOn || null
        };
      })
      .sort((a, b) => (b.lastAudit || b.createdOn).localeCompare(a.lastAudit || a.createdOn)));
  }

  async getStudy(id) {
    const study = this.studies.find((candidate) => candidate.id === Number(id));
    if (!study) return null;
    const audits = this.audits.filter((audit) => audit.studyId === study.id);
    return clone({
      ...study,
      auditCount: audits.length,
      lastAudit: audits.sort((a, b) => b.createdOn.localeCompare(a.createdOn))[0]?.createdOn || null
    });
  }

  async getStudyThumbnail(id) {
    return this.studies.find((study) => study.id === Number(id))?.thumbnailPng || null;
  }

  async listWorksheets(type) {
    return clone(this.worksheets
      .filter((worksheet) => !type || worksheet.recommendFor.includes(type))
      .sort((a, b) => a.title.localeCompare(b.title)));
  }

  async getWorksheet(id) {
    return clone(this.worksheets.find((worksheet) => worksheet.id === Number(id)) || null);
  }

  decorateAudit(audit) {
    const user = this.users.find((candidate) => candidate.id === audit.createdBy);
    const worksheet = this.worksheets.find((candidate) => candidate.id === audit.worksheetId);
    return {
      ...audit,
      contributorName: user?.name || 'Unknown contributor',
      worksheetTitle: worksheet?.title,
      worksheetPrompts: clone(worksheet?.prompts || [])
    };
  }

  async listAudits(studyId) {
    return clone(this.audits
      .filter((audit) => audit.studyId === Number(studyId))
      .sort((a, b) => b.createdOn.localeCompare(a.createdOn))
      .map((audit) => this.decorateAudit(audit)));
  }

  async getAudit(id) {
    const audit = this.audits.find((candidate) => candidate.id === Number(id));
    return audit ? clone(this.decorateAudit(audit)) : null;
  }

  async createDraft({ studyId, userId, editingAuditId = null }) {
    let seed = {};
    if (editingAuditId) {
      const audit = await this.getAudit(editingAuditId);
      if (!audit || audit.studyId !== Number(studyId)) throw new Error('Audit not found.');
      if (audit.createdBy !== Number(userId)) throw new Error('You can only edit audits you submitted.');
      seed = audit;
    }
    const draft = {
      id: crypto.randomUUID(),
      studyId: Number(studyId),
      createdBy: Number(userId),
      editingAuditId: editingAuditId ? Number(editingAuditId) : null,
      type: seed.type || null,
      worksheetId: seed.worksheetId || null,
      locationGps: clone(seed.locationGps || null),
      locationDescription: seed.locationDescription || null,
      geojson: clone(seed.geojson || null),
      answers: clone(seed.answers || {}),
      updatedOn: new Date().toISOString()
    };
    this.drafts.push(draft);
    return clone(draft);
  }

  async getDraft(id, userId) {
    return clone(this.drafts.find((draft) => draft.id === id && draft.createdBy === Number(userId)) || null);
  }

  async updateDraft(id, userId, updates) {
    const draft = this.drafts.find((candidate) => candidate.id === id && candidate.createdBy === Number(userId));
    if (!draft) return null;
    Object.assign(draft, clone(updates), { updatedOn: new Date().toISOString() });
    return clone(draft);
  }

  async submitDraft(id, userId) {
    const draftIndex = this.drafts.findIndex((draft) => draft.id === id && draft.createdBy === Number(userId));
    if (draftIndex < 0) throw new Error('Draft not found.');
    const draft = this.drafts[draftIndex];
    if (!draft.type || !draft.worksheetId || !draft.locationGps || !draft.locationDescription || !draft.geojson) {
      throw new Error('Complete the audit type, location, description, and worksheet before submitting.');
    }
    let audit;
    if (draft.editingAuditId) {
      audit = this.audits.find((candidate) => candidate.id === draft.editingAuditId && candidate.createdBy === Number(userId));
      if (!audit) throw new Error('Audit not found or cannot be edited.');
      Object.assign(audit, {
        type: draft.type,
        worksheetId: draft.worksheetId,
        locationGps: clone(draft.locationGps),
        locationDescription: draft.locationDescription,
        geojson: clone(draft.geojson),
        answers: clone(draft.answers),
        updatedOn: new Date().toISOString()
      });
    } else {
      const now = new Date().toISOString();
      audit = {
        id: this.ids.audit++,
        studyId: draft.studyId,
        createdBy: Number(userId),
        createdOn: now,
        updatedOn: now,
        type: draft.type,
        worksheetId: draft.worksheetId,
        locationGps: clone(draft.locationGps),
        locationDescription: draft.locationDescription,
        geojson: clone(draft.geojson),
        answers: clone(draft.answers)
      };
      this.audits.push(audit);
    }
    this.drafts.splice(draftIndex, 1);
    return clone(this.decorateAudit(audit));
  }

  async listReports(studyId) {
    return clone(this.reports
      .filter((report) => report.studyId === Number(studyId))
      .sort((a, b) => b.createdOn.localeCompare(a.createdOn)));
  }

  async createReport(data) {
    const report = { id: this.ids.report++, createdOn: new Date().toISOString(), ...clone(data) };
    this.reports.push(report);
    return clone(report);
  }
}

export async function createRepository() {
  if (process.env.DATABASE_URL && process.env.DEMO_MODE !== 'true') {
    const repository = new PostgresRepository(process.env.DATABASE_URL);
    try {
      await repository.ping();
      return repository;
    } catch (error) {
      console.warn(`PostgreSQL is unavailable; falling back to the in-memory demo repository. ${error.message}`);
      process.env.DEMO_MODE = 'true';
      return new MemoryRepository({ seedDemo: process.env.NODE_ENV !== 'test' });
    }
  }
  return new MemoryRepository({ seedDemo: process.env.NODE_ENV !== 'test' });
}
