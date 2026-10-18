#!/usr/bin/env bash
# Builds dist/module.zip and dist/module.json for a manual GitHub release.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p 'require("./module.json").version')
download=$(node -p 'require("./module.json").download')
if [[ "$download" != *"/v${version}/module.zip" ]]; then
  echo "module.json: 'download' must point to v${version}/module.zip (found: ${download})" >&2
  exit 1
fi

rm -rf dist && mkdir dist
zip -qr dist/module.zip module.json scripts lang LICENSE README.md CHANGELOG.md
cp module.json dist/module.json
echo "dist/ ready for v${version}"
