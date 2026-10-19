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

manifest=$(node -p 'require("./module.json").manifest')
url=$(node -p 'require("./module.json").url.replace(/\/$/, "")')
if [[ "$manifest" != "${url}/releases/latest/download/module.json" ]]; then
  echo "module.json: 'manifest' must point to ${url}/releases/latest/download/module.json (found: ${manifest})" >&2
  exit 1
fi

rm -rf dist && mkdir dist
zip -qr dist/module.zip module.json scripts lang templates styles LICENSE README.md CHANGELOG.md
cp module.json dist/module.json
echo "dist/ ready for v${version}"
