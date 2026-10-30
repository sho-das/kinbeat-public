-- One finished scan of a public repository, kept for the exact commit it was made from.
-- The value is the masked result, the same content as a scan record. It holds no plain secret.
CREATE TABLE repo_results (
  key        text PRIMARY KEY,
  slug       text NOT NULL,
  sha        text NOT NULL,
  commit_at  timestamptz,
  commit_url text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  value      jsonb NOT NULL
);
CREATE INDEX repo_results_slug_idx ON repo_results (slug);
CREATE INDEX repo_results_at_idx ON repo_results (at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kinbeat_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON repo_results TO kinbeat_app;
  END IF;
END $$;
