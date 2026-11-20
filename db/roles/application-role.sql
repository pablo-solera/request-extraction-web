-- Application database role: DML only, no DDL. Not part of db/migrations on purpose (drizzle-kit would replay it and it needs a password).
--
-- Run as the migration/owner role (the one in DATABASE_MIGRATION_URL, normally POSTGRES_USER) AFTER `npm run db:migrate`, and again
-- after any migration that adds tables if ALTER DEFAULT PRIVILEGES below was not in place. It is idempotent.
--
--   psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=1 -v app_password='...' -f db/roles/application-role.sql
--
-- Then point DATABASE_URL at request_extraction_app and keep DATABASE_MIGRATION_URL for db:migrate / db:deploy.
-- The application never issues DELETE, so only SELECT, INSERT and UPDATE are granted.

SELECT format('CREATE ROLE request_extraction_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'request_extraction_app')
\gexec

SELECT format('ALTER ROLE request_extraction_app PASSWORD %L', :'app_password')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO request_extraction_app', current_database())
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO request_extraction_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO request_extraction_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO request_extraction_app;
