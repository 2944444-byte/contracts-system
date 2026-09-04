#!/usr/bin/env bash
# Read-only dump of the OLD project into a dated folder + tar archive + checksums.
# Requires: supabase CLI, Docker running, ~/.propmanager-migration.env with OLD_DB_URL.
set -euo pipefail
export PATH="/usr/local/opt/libpq/bin:$PATH"
source "$HOME/.propmanager-migration.env"
# --db-url must be percent-encoded: encode the password part in case it holds special characters.
OLD_DB_URL="$(python3 - "$OLD_DB_URL" <<'PY'
import sys, re, urllib.parse
u = sys.argv[1]
m = re.match(r'^(postgres(?:ql)?://[^:]+:)(.*)(@[^@]+)$', u)
pw = m.group(2) if m else ''
if pw.startswith('[') and pw.endswith(']'): pw = pw[1:-1]
print(m.group(1) + urllib.parse.quote(pw, safe='') + m.group(3) if m else u)
PY
)"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$HOME/propmanager-migration/$STAMP"
mkdir -p "$OUT"; cd "$OUT"

supabase db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$OLD_DB_URL" -f schema.sql
supabase db dump --db-url "$OLD_DB_URL" -f data.sql --use-copy --data-only \
  -x storage.objects,storage.buckets_vectors,storage.vector_indexes
supabase db dump --db-url "$OLD_DB_URL" -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url "$OLD_DB_URL" -f history_data.sql --use-copy --data-only --schema supabase_migrations

shasum -a 256 *.sql > SHA256SUMS
ls -la
( cd .. && tar czf "propmanager-dump-$STAMP.tgz" "$STAMP" )
echo "DUMP_DIR=$OUT"
echo "ARCHIVE=$HOME/propmanager-migration/propmanager-dump-$STAMP.tgz"
