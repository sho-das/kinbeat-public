CREATE TABLE scans (
  id          text PRIMARY KEY,
  at          timestamptz NOT NULL,
  kind        text NOT NULL,
  label       text NOT NULL,
  chars       integer,
  files       integer,
  duration_ms integer NOT NULL,
  mode        text NOT NULL,
  model       text NOT NULL,
  summary     jsonb NOT NULL,
  verdicts    jsonb NOT NULL,
  result      jsonb NOT NULL
);
CREATE INDEX scans_at_idx ON scans (at DESC, id DESC);

CREATE TABLE cases (
  id          text PRIMARY KEY,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  scan_id     text NOT NULL,
  scan_label  text NOT NULL,
  finding_id  text NOT NULL,
  type        text NOT NULL,
  encoding    text NOT NULL,
  source      text,
  place       jsonb NOT NULL,
  preview     text NOT NULL,
  hash        text,
  confidence  jsonb NOT NULL,
  verdict     text NOT NULL,
  status      text NOT NULL,
  owner       text NOT NULL DEFAULT '',
  history     jsonb NOT NULL
);
CREATE UNIQUE INDEX cases_hash_type_idx ON cases (hash, type) WHERE hash IS NOT NULL;
CREATE INDEX cases_updated_idx ON cases (updated_at DESC);
