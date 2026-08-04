#!/usr/bin/env bash
# Stage chain silo snapshots from the data branch into the index/working tree so
# sync scripts have a baseline after those files are no longer tracked on app
# branches. Staging (via git checkout) is required so later `git diff` detect
# steps still work while the paths are gitignored on master/feature.
#
# Env:
#   TARGET_BRANCH — default: legacy-positions

set -euo pipefail

TARGET_BRANCH="${TARGET_BRANCH:-legacy-positions}"
CHAINS=(ethereum arbitrum avalanche injective sonic xdc)

git fetch origin "${TARGET_BRANCH}"

mkdir -p src/data/silos
restored=0
for chain in "${CHAINS[@]}"; do
  path="src/data/silos/${chain}.json"
  if git cat-file -e "origin/${TARGET_BRANCH}:${path}" 2>/dev/null; then
    git checkout "origin/${TARGET_BRANCH}" -- "${path}"
    echo "::notice::Bootstrapped ${path} from ${TARGET_BRANCH}"
    restored=$((restored + 1))
  else
    echo "::warning::No ${path} on ${TARGET_BRANCH} yet"
  fi
done

if [ "${restored}" -eq 0 ]; then
  echo "::error::No silo snapshots found on ${TARGET_BRANCH}; publish them before running sync."
  exit 1
fi
