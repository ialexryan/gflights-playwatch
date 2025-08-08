#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
# Random jitter 0–90s to look human and avoid synchronized polling
sleep $(( RANDOM % 91 ))
/usr/bin/env node watch.js >> logs/watch.log 2>> logs/watch.err
