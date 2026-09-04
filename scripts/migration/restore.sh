#!/usr/bin/env bash
# Restore a dump folder into the NEW project, all-or-nothing per step.
# Usage: restore.sh <dump-dir>
# Requires: psql (libpq), ~/.propmanager-migration.env with NEW_DB_URL.
set -euo pipefail
export PATH="/usr/local/opt/libpq/bin:$PATH"
source "$HOME/.propmanager-migration.env"
NEW_DB_URL="$(python3 - "$NEW_DB_URL" <<'PY'
import sys, re, urllib.parse
u = sys.argv[1]
m = re.match(r'^(postgres(?:ql)?://[^:]+:)(.*)(@[^@]+)$', u)
pw = m.group(2) if m else ''
if pw.startswith('[') and pw.endswith(']'): pw = pw[1:-1]
print(m.group(1) + urllib.parse.quote(pw, safe='') + m.group(3) if m else u)
PY
)"
DUMP="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
OLD_REF="ndvcqgrpsqykhodiyrhx"
NEW_REF="$(echo "$NEW_DB_URL" | sed -E 's#.*postgres\.([a-z]+):.*#\1#')"
echo "target ref: $NEW_REF"

echo "== 1/4 roles + schema + data (single transaction, triggers off)"
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$DUMP/roles.sql" --file "$DUMP/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$DUMP/data.sql" --dbname "$NEW_DB_URL"

echo "== 2/4 migration history"
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$DUMP/history_schema.sql" --file "$DUMP/history_data.sql" --dbname "$NEW_DB_URL"

echo "== 3/4 storage policies"
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$HERE/storage-policies.sql" --dbname "$NEW_DB_URL"

echo "== 4/4 rewrite stored URLs $OLD_REF -> $NEW_REF (triggers off)"
sed -e "s/__OLD__/$OLD_REF/g" -e "s/__NEW__/$NEW_REF/g" "$HERE/rewrite-urls.sql" > "$DUMP/rewrite-urls.resolved.sql"
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --command 'SET session_replication_role = replica' \
  --file "$DUMP/rewrite-urls.resolved.sql" --dbname "$NEW_DB_URL"
echo "restore done"
