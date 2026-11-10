#!/usr/bin/env bash
# A gate that is red for thousands of pre-existing findings is a number nobody
# reads. This turns it into a ratchet: the count may go DOWN, never up, so new
# debt is caught on the commit that adds it and the old debt is paid deliberately.
#
# Usage: ratchet.sh <label> <measured> <baseline>
set -euo pipefail

label="$1"
measured="$2"
baseline="$3"

if [ "$measured" -gt "$baseline" ]; then
  echo "::error::${label} grew from ${baseline} to ${measured}. Fix the new findings, or lower nothing and explain in the PR why the baseline must rise."
  exit 1
fi

if [ "$measured" -lt "$baseline" ]; then
  echo "::warning::${label} is down to ${measured} (baseline ${baseline}). Lower the baseline in .github/ci/baseline.env in this PR so the gain sticks."
else
  echo "${label}: ${measured} (baseline ${baseline}) - unchanged."
fi
