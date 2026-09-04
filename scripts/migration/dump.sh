#!/usr/bin/env bash
# Read-only dump of the OLD project into a dated folder + tar archive + checksums.
# Requires: supabase CLI, Docker running, ~/.propmanager-migration.env with OLD_DB_URL.
set -euo pipefail
source "$HOME/.propmanager-migration.env"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$HOME/propmanager-migration/$STAMP"
mkdir -p "$OUT"; cd "$OUT"

supabase db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql
supabase db dump --db-url "$OLD_DB_URL" -f data.sql --use-copy --data-only \
  -x storage.objects -x storage.buckets_vectors -x storage.vector_indexes
supabase db dump --db-url "$OLD_DB_URL" -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url "$OLD_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations

shasum -a 256 *.sql > SHA256SUMS
ls -la
( cd .. && tar czf "propmanager-dump-$STAMP.tgz" "$STAMP" )
echo "DUMP_DIR=$OUT"
echo "ARCHIVE=$HOME/propmanager-migration/propmanager-dump-$STAMP.tgz"
