#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs

# Set PATH to include Homebrew for launchd
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

# Random jitter 0–90s to look human and avoid synchronized polling
sleep $(( RANDOM % 91 ))
node watch.js >> logs/watch.log 2>> logs/watch.err