#!/usr/bin/env bash
# rebuilds frontend/studymind-extension.zip from the extension/ folder.
# run this again after changing a file in extension/ so the download button
# on the extension guide page stays up to date
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rm -f "$ROOT/frontend/studymind-extension.zip"
cd "$ROOT/extension"
zip -r "$ROOT/frontend/studymind-extension.zip" . -x ".*"

echo "Rebuilt frontend/studymind-extension.zip"
