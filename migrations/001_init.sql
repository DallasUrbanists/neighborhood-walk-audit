CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  email TEXT NOT NULL UNIQUE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studies (
  id SERIAL PRIMARY KEY,
  neighborhood TEXT NOT NULL CHECK (char_length(trim(neighborhood)) BETWEEN 1 AND 160),
  created_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INTEGER NOT NULL REFERENCES users(id),
  location_gps JSONB NOT NULL,
  location_description TEXT NOT NULL,
  area JSONB NOT NULL,
  intersections JSONB NOT NULL,
  segments JSONB NOT NULL,
  thumbnail_path TEXT,
  thumbnail_png BYTEA
);

CREATE TABLE IF NOT EXISTS worksheets (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_url TEXT NOT NULL,
  recommend_for TEXT[] NOT NULL,
  prompts JSONB NOT NULL,
  created_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audits (
  id SERIAL PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('intersection', 'street-segment')),
  worksheet_id INTEGER NOT NULL REFERENCES worksheets(id),
  location_gps JSONB NOT NULL,
  location_description TEXT NOT NULL,
  geojson JSONB NOT NULL,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS audit_drafts (
  id UUID PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INTEGER NOT NULL REFERENCES users(id),
  editing_audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
  type TEXT CHECK (type IS NULL OR type IN ('intersection', 'street-segment')),
  worksheet_id INTEGER REFERENCES worksheets(id),
  location_gps JSONB,
  location_description TEXT,
  geojson JSONB,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audits INTEGER[] NOT NULL,
  completion NUMERIC(6,5) NOT NULL CHECK (completion BETWEEN 0 AND 1),
  description TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS studies_created_by_idx ON studies(created_by);
CREATE INDEX IF NOT EXISTS audits_study_created_idx ON audits(study_id, created_on DESC);
CREATE INDEX IF NOT EXISTS audits_created_by_idx ON audits(created_by);
CREATE INDEX IF NOT EXISTS audit_drafts_owner_idx ON audit_drafts(created_by, updated_on DESC);
CREATE INDEX IF NOT EXISTS reports_study_created_idx ON reports(study_id, created_on DESC);
