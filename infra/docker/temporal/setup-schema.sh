#!/bin/sh
# Creates Temporal's two databases in our Postgres and brings their schemas up to date.
# Every step is idempotent (verified against temporal-sql-tool 1.32), so this runs on each `pnpm infra:up`.
# On AWS the same commands run as a one-off task before a server upgrade.
set -eu

for db in temporal temporal_visibility; do
  schema=temporal
  [ "$db" = temporal_visibility ] && schema=visibility
  sql="temporal-sql-tool --plugin postgres12 --ep $POSTGRES_SEEDS -p ${DB_PORT:-5432} -u $POSTGRES_USER --db $db"
  $sql create
  $sql setup-schema -v 0.0
  $sql update-schema -d "/etc/temporal/schema/postgresql/v12/$schema/versioned"
done
echo "Temporal schemas are up to date"
