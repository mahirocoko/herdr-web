#!/usr/bin/env bash
# CI only: apt on the runners has sat on an Ubuntu mirror until the job's own timeout, past
# apt's own timers (a stall they do not see). Each attempt gets a wall-clock limit; one that
# fails or runs past it is ended with everything it started, and the command runs again.
# usage: ci-bounded-retry.sh <seconds per attempt> <command...>
set -uo pipefail
limit=$1
shift
for attempt in 1 2 3; do
  timeout --kill-after=15 "$limit" "$@" && exit 0
  echo "ci-bounded-retry: attempt $attempt of 3 failed or ran past ${limit}s: $*" >&2
done
exit 1
