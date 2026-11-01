#!/usr/bin/env bash
set +x
set -euo pipefail
cd "$(dirname "$0")/.."
node packages/keeper/dist/keeper/src/agent-preflight.js
