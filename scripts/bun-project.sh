#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# Compatibility entry for Unix checkouts without Bun on PATH. This only finds a
# bootstrap engine; bun-project.mjs exclusively owns version selection/dispatch.
engine="$(command -v bun || true)"
if [[ -z "$engine" ]]; then
  for candidate in "$root"/.agent-state/tools/bun/*/bun-*/bun; do
    if [[ -x "$candidate" ]]; then engine="$candidate"; break; fi
  done
fi
if [[ -z "$engine" ]]; then
  printf '%s\n' 'Bun 1.4.2 was not found. Provide that version on PATH or use the existing project-local copy; no runtime was installed.' >&2
  exit 1
fi
exec "$engine" "$root/scripts/bun-project.mjs" "$@"
