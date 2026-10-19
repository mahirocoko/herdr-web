#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
local_bin="$root/.agent-state/tools/bun/1.4.2/bun-darwin-aarch64/bun"
if [[ -x "$local_bin" ]]; then
  binary="$local_bin"
else
  binary="$(command -v bun)"
fi
if [[ "$("$binary" --version)" != '1.4.2' ]]; then
  printf '%s\n' 'Use the verified project-local Bun 1.4.2 (or CI Bun 1.4.2); do not upgrade the global runtime.' >&2
  exit 1
fi
export PATH="$(dirname "$binary"):$PATH"
export UNIT_TEST_WORKERS="${UNIT_TEST_WORKERS:-1}"
export HERDR_TEST_SHARDS="${HERDR_TEST_SHARDS:-1}"
cd "$root"
exec "$binary" "$@"
