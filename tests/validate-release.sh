#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/backend/server.owner-os.js"
python - "$ROOT/public/admin.html" <<'PY'
from pathlib import Path
import re,sys,subprocess,tempfile
p=Path(sys.argv[1]); text=p.read_text(); blocks=re.findall(r'<script>(.*?)</script>',text,re.S)
if not blocks: raise SystemExit('No inline script found')
for i,b in enumerate(blocks):
    q=Path(tempfile.gettempdir())/f'muda_admin_{i}.js'; q.write_text(b)
    subprocess.run(['node','--check',str(q)],check=True)
print('admin.html inline JS syntax: OK')
PY
printf 'Release syntax validation: OK\n'

 test -f supabase/migrations/014_owner_action_matrix.sql
