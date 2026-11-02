#!/usr/bin/env bash
# Vercel's "Ignored Build Step" for the /dyno bot: exit 0 skips the deploy, exit 1 builds it.
#
# Only main gets a live bot. Branches and pull requests, forks included, are skipped
# outright, so nobody's unmerged code ever answers in the testers' server.
#
# On main, build only when something the bot runs changed: the bot itself, the sim, the
# colour tokens the chart reads, or the embed builder the reply uses. Anything else (the
# app's UI, docs) would redeploy an identical bot. If the diff can't be computed (no
# parent commit in the clone), git exits non-zero and the deploy goes ahead, the safe way
# to fail.
set -u

if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  echo "Not main (${VERCEL_GIT_COMMIT_REF:-unset}): skipping. Only main gets a live bot."
  exit 0
fi

if git diff --quiet HEAD^ HEAD -- . ../src/sim ../src/ui/tokens.js ../scripts/discord-notify.js; then
  echo "Nothing the bot uses changed: skipping."
  exit 0
fi

echo "The bot or something it imports changed: building."
exit 1
