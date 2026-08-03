#!/usr/bin/env bash
# Push chain silo snapshot JSON files to the shared data branch (legacy-positions).
#
# Usage:
#   scripts/ci/push-silos-to-data-branch.sh <export_dir>
#
# <export_dir> must contain chain files such as ethereum.json, arbitrum.json, …
# (not blacklist/). Files are written to src/data/silos/ on TARGET_BRANCH.
#
# Env:
#   TARGET_BRANCH   — default: legacy-positions
#   COMMIT_MESSAGE  — default: chore: sync silo snapshots to data branch
#
# Leaves the workspace on TARGET_BRANCH after a successful push. Caller restores
# the source ref if further steps need master/blacklist.

set -euo pipefail

EXPORT_DIR="${1:-}"
TARGET_BRANCH="${TARGET_BRANCH:-legacy-positions}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-chore: sync silo snapshots to data branch}"

if [ -z "${EXPORT_DIR}" ] || [ ! -d "${EXPORT_DIR}" ]; then
  echo "::error::Export dir missing or not a directory: ${EXPORT_DIR:-<unset>}"
  exit 1
fi

shopt -s nullglob
FILES=("${EXPORT_DIR}"/*.json)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "::error::No *.json silo snapshots found in ${EXPORT_DIR}"
  exit 1
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Bundle lives outside the repo; clean workspace before switching branches.
git reset --hard HEAD
git clean -fd

for attempt in 1 2 3; do
  git fetch origin "${TARGET_BRANCH}" || true
  if git show-ref --verify --quiet "refs/remotes/origin/${TARGET_BRANCH}"; then
    git checkout -B "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"
  else
    git checkout -B "${TARGET_BRANCH}"
  fi

  mkdir -p src/data/silos
  for src in "${FILES[@]}"; do
    base="$(basename "${src}")"
    # Never publish blacklist files onto the data-branch silo path from this script.
    if [ "${base}" = "blacklist.json" ]; then
      continue
    fi
    cp "${src}" "src/data/silos/${base}"
  done

  git add src/data/silos/*.json

  if git diff --staged --quiet; then
    echo "::notice::No silo snapshot changes to commit on ${TARGET_BRANCH}."
    exit 0
  fi

  git commit -m "${COMMIT_MESSAGE}"
  if git push origin "HEAD:${TARGET_BRANCH}"; then
    echo "::notice::Pushed silo snapshots to ${TARGET_BRANCH} on attempt ${attempt}."
    exit 0
  fi

  echo "::warning::Push to ${TARGET_BRANCH} failed on attempt ${attempt}; retrying after rebase."
  git reset --hard HEAD~1 || true
done

echo "::error::Failed to push silo snapshots to ${TARGET_BRANCH} after 3 attempts."
exit 1
