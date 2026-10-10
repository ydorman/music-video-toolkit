#!/usr/bin/env bash
# One-time setup of the build environment (Claude's container or your Mac).
# Installs Python deps, fetches makehuman-core (pinned) into vendor/, and JS libs used for headless tests.
set -e
cd "$(dirname "$0")/.."
PIP="pip install -q"
python3 -c "import sys; sys.exit(0 if sys.prefix==sys.base_prefix else 1)" && PIP="pip install -q --break-system-packages" || true
$PIP numpy librosa pillow
MH_COMMIT=06e129ac920593f9f315e03d6d5b3f843504de7f
mkdir -p vendor
if [ ! -d vendor/makehuman-core ]; then
  git clone -q https://github.com/vidya-hub/makehuman-core.git vendor/makehuman-core
fi
(cd vendor/makehuman-core && git fetch -q origin && git checkout -q $MH_COMMIT)
$PIP --no-deps -e vendor/makehuman-core
# optional: headless smoke tests (Claude's container); skip if npm/playwright are missing
if command -v npm >/dev/null; then
  mkdir -p vendor/js && cd vendor/js
  [ -f three/build/three.min.js ] || { npm pack -q three@0.149.0 >/dev/null && mkdir -p three && tar xzf three-0.149.0.tgz -C three --strip-components=1; }
  [ -f mp4-muxer/build/mp4-muxer.js ] || { npm pack -q mp4-muxer@5.1.3 >/dev/null && mkdir -p mp4-muxer && tar xzf mp4-muxer-5.1.3.tgz -C mp4-muxer --strip-components=1; }
  cd ../..
fi
python3 -c "import mhcore, librosa; print('setup ok: makehuman-core + librosa')"
