#!/bin/bash
# Publishes the site code in this working copy (index.html, js/, css/, admin/) to dev/ on GitHub Pages:
#   https://hberube.github.io/patinoire/dev/
# a preview with a DEV banner that reads the live site's data (data/, img/ through window.POOL_ROOT,
# see js/util.js), so Hugo can check a change before it goes live. Only dev/ is committed; the
# real files stay uncommitted until he approves. Python scripts can't be previewed this way (they
# run on the PC); new data files show only once they exist on the live site.
#   bash scripts/dev_publish.sh "what changed"
#   bash scripts/dev_publish.sh --local       build dev/ only, to look at it on this PC
set -euo pipefail
cd "$(dirname "$0")/.."
MSG=${1:-"Dev preview"}
rm -rf dev && mkdir -p dev
cp -r index.html js css admin dev/
# Same CSS, but its images are one folder further up
sed -i 's#url("\.\./img/#url("../../img/#g' dev/css/style.css
python3 - <<'PY'
import re, time
from pathlib import Path
STAMP = time.strftime("%Y%m%d%H%M%S")
# ...and the same for every import between modules (./x.js, ../js/x.js)
for js in [*Path("dev/js").rglob("*.js"), *Path("dev/admin").glob("*.js")]:
  t = js.read_text(encoding="utf-8")
  js.write_text(re.sub(r'((?:from|import)\s*\(?\s*)"(\.{1,2}/[^"?]+\.js)"', rf'\1"\2?v={STAMP}"', t), encoding="utf-8")
for page, root in (("dev/index.html", "../"), ("dev/admin/index.html", "../../")):
  p = Path(page); s = p.read_text(encoding="utf-8")
  head = ('  <meta name="robots" content="noindex">\n'
        f'  <script>window.POOL_ROOT = "{root}";</script>\n'
        '  <style>body::before{content:"DEV · aperçu";position:fixed;z-index:2000;left:50%;bottom:10px;'
        'transform:translateX(-50%);background:#f5b301;color:#111;font:700 12px/1 Inter,sans-serif;padding:7px 12px;'
        'border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none}</style>\n')
  # A new address for every file at each publish, so browsers never run an older preview from cache
  s = re.sub(r'(src|href)="((?:\.\./)?(?:js|css)/[^"?]+|admin\.(?:js|css))"', rf'\1="\2?v={STAMP}"', s)
  assert s.count("</head>") == 1 and s.count("<title>") == 1
  s = s.replace("</head>", head + "</head>").replace("<title>", "<title>DEV · ")
  p.write_text(s, encoding="utf-8")
PY
[ "$MSG" = "--local" ] && { echo "dev: built in dev/ (not published)"; exit 0; }
git add dev
if git diff --staged --quiet -- dev; then echo "dev: nothing new"; exit 0; fi
git commit -q -m "$MSG" -- dev
git pull -q --rebase --autostash && git push -q
echo "dev: published, live in ~1 min at https://hberube.github.io/patinoire/dev/"
