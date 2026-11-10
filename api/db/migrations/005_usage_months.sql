-- Model tokens used per calendar month (UTC), added up across every request. The month's cost comes from these counts
-- and the price settings, and the spend guard stops model calls when it nears the monthly limit. No text is stored.
CREATE TABLE usage_months (
  month         text PRIMARY KEY,
  calls         bigint NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kinbeat_app') THEN
    GRANT SELECT, INSERT, UPDATE ON usage_months TO kinbeat_app;
  END IF;
END $$;
