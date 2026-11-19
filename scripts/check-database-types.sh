#!/bin/sh
set -eu
if [ "${JUMPLAB_TEST_DISPOSABLE:-}" != YES ] || ! command -v supabase >/dev/null 2>&1; then
  printf '%s\n' 'BLOCKED: install the Supabase CLI and apply migrations to a disposable local stack. Then set JUMPLAB_TEST_DISPOSABLE=YES.' >&2
  exit 2
fi
mkdir -p .cache
supabase gen types typescript --local --schema public > .cache/database.generated.ts
test -s .cache/database.generated.ts
diff -u src/data/database.types.ts .cache/database.generated.ts
