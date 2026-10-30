CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  admin_id    text,
  admin_email text,
  action      text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  ip          text
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC, id DESC);

CREATE TABLE login_attempts (
  key text NOT NULL,
  at  timestamptz NOT NULL
);
CREATE INDEX login_attempts_key_idx ON login_attempts (key, at);

-- The API runs as kinbeat_app: it may read and write its data, and only add to the audit log.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kinbeat_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON scans, cases, admins, login_tokens, sessions, login_attempts TO kinbeat_app;
    GRANT SELECT, INSERT ON audit_log TO kinbeat_app;
    GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO kinbeat_app;
    GRANT SELECT ON schema_migrations TO kinbeat_app;
  END IF;
END $$;
