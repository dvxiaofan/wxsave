#!/usr/bin/env bash
# verify-normalize-parity.sh
# Sanity check: lib/wxsave-url.js normalizeUrl() and bin/wxwatch
# normalize_link() (Python) must produce bit-identical dedup keys. If this
# drifts, the two dedup stores (~/.local/share/wxsave/archived.json and
# ~/.local/share/wxwatch/<name>.state.json) will start disagreeing on what
# "same article" means.
#
# Run manually after changing either normalize_link implementation:
#   npm run test:parity
#
# Zero deps: stock node + python3.

set -e

cd "$(dirname "$0")/.."

SAMPLES=(
  "https://mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ"
  "https://mp.weixin.qq.com/s/QEyGMz4Hc8T39xVYlynhTQ?chksm=abc&sn=xyz#wechat_redirect"
  "https://mp.weixin.qq.com/s?__biz=MjM5ODAzNTc2NA==&mid=2653458123&idx=1&chksm=xyz"
  "https://mp.weixin.qq.com/s?__biz=ABC&mid=123&idx=2"
  "https://example.com/foo?bar=1#baz"
  "https://mp.weixin.qq.com/other?foo=1"
)

NODE_OUT="$(mktemp)"
PY_OUT="$(mktemp)"
trap 'rm -f "$NODE_OUT" "$PY_OUT"' EXIT

# --- Node ---
node -e '
const { normalizeUrl } = require("./lib/wxsave-url");
for (const u of process.argv.slice(1)) console.log(normalizeUrl(u));
' "${SAMPLES[@]}" > "$NODE_OUT"

# --- Python (logic copied from bin/wxwatch normalize_link) ---
python3 - "${SAMPLES[@]}" <<'PY' > "$PY_OUT"
import sys, re
from urllib.parse import parse_qs, urlparse

def normalize_link(url):
    if "mp.weixin.qq.com" not in url:
        return url.split("#")[0]
    m = re.search(r"mp\.weixin\.qq\.com/s/([A-Za-z0-9_\-]+)", url)
    if m:
        return f"mp.weixin.qq.com/s/{m.group(1)}"
    p = urlparse(url)
    q = parse_qs(p.query)
    biz = (q.get("__biz") or [""])[0]
    mid = (q.get("mid") or [""])[0]
    idx = (q.get("idx") or [""])[0]
    if biz and mid and idx:
        return f"mp.weixin.qq.com/?__biz={biz}&mid={mid}&idx={idx}"
    return url.split("#")[0].split("?")[0]

for u in sys.argv[1:]:
    print(normalize_link(u))
PY

if diff -u "$PY_OUT" "$NODE_OUT"; then
  echo "OK: normalize_link parity across ${#SAMPLES[@]} samples"
  exit 0
else
  echo ""
  echo "DRIFT: Node and Python normalize_link diverged." >&2
  echo "  lib/wxsave-url.js normalizeUrl  (Node, left side)" >&2
  echo "  bin/wxwatch normalize_link      (Python, right side)" >&2
  exit 1
fi
