#!/usr/bin/env bash
# Vercel's "Ignored Build Step" for the /dyno bot: exit 0 skips the deploy, exit 1 builds it.
#
# Only main gets a live bot. Branches and pull requests, forks included, are skipped
# outright, so nobody's unmerged code ever answers in the testers' server. The branch name
# alone isn't enough for that: a fork's pull request can come from a branch the fork also
# calls main. Vercel marks only deployments of this project's own production branch as
# production, so both are checked.
#
# On main, build only when something the bot runs changed: the bot itself, the sim, the
# colour tokens the chart reads, or the embed builder the reply uses. Anything else (the
# app's UI, docs) would redeploy an identical bot.
#
# "Changed" means since the last SUCCESSFUL deployment, not since the previous commit.
# Vercel sets VERCEL_GIT_PREVIOUS_SHA for this step to that deployment's commit, so the
# diff covers several merges landing since the last deploy, and a deploy that failed or was
# superseded (the bot's change would otherwise be hidden behind a later docs-only commit).
# The first deploy has no previous SHA and always builds. If the diff can't be computed
# (for example the SHA isn't in the shallow clone), git exits non-zero and the deploy goes
# ahead, the safe way to fail.
set -u

if [ "${VERCEL_ENV:-}" != "production" ] || [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  echo "Not a production deploy of main (${VERCEL_ENV:-unset}, ${VERCEL_GIT_COMMIT_REF:-unset}): skipping. Only main gets a live bot."
  exit 0
fi

if [ -z "${VERCEL_GIT_PREVIOUS_SHA:-}" ]; then
  echo "No previous successful deployment: building."
  exit 1
fi

if git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . ../src/sim ../src/ui/tokens.js ../scripts/discord-notify.js; then
  echo "Nothing the bot uses changed since the last deployment: skipping."
  exit 0
fi

echo "The bot or something it imports changed: building."
exit 1
