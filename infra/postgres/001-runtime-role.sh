#!/usr/bin/env bash
set -euo pipefail
# psql reads the generated password from its environment, never a command argument.
psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password FMV_APP_PASSWORD
CREATE ROLE fmv_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
REVOKE ALL ON DATABASE fmv_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE fmv_dev TO fmv_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
