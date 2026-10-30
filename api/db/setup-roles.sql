-- Run once as a Postgres superuser:  psql postgres -f db/setup-roles.sql
-- kinbeat_owner owns the tables and runs the migrations.
-- kinbeat_app is what the API uses while it runs. It cannot change or delete the audit log.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kinbeat_owner') THEN
    CREATE ROLE kinbeat_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kinbeat_app') THEN
    CREATE ROLE kinbeat_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

ALTER DATABASE kinbeat OWNER TO kinbeat_owner;
ALTER DATABASE kinbeat_test OWNER TO kinbeat_owner;

\connect kinbeat
REASSIGN OWNED BY kinbeat_app TO kinbeat_owner;

\connect kinbeat_test
REASSIGN OWNED BY kinbeat_app TO kinbeat_owner;
