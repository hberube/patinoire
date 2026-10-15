#!/bin/bash
# Backup for GitHub's unreliable schedule, started by Windows Task Scheduler (see README.md here).
#   pool_job.sh night    from noon: keep "Ce soir" live until the last game, then rebuild the standings
#   pool_job.sh morning  early morning: rebuild the standings (and the history chart) if still needed,
#                        then have Claude write the front-page recap (needs ~/.local/bin/claude, logged in)
# Runs in its own clone so it never touches a working copy. Safe to run alongside the GitHub
# workflows: they all produce the same data, and a second copy of the same job exits right away.
set -u
MODE=${1:?usage: pool_job.sh night|morning}
BOT=${POOL_BOT_DIR:-$HOME/patinoire-bot}
REPO=https://github.com/hberube/patinoire.git
LOG=$BOT-$MODE.log
exec >>"$LOG" 2>&1
exec 9>"$BOT-$MODE.lock"
flock -n 9 || { echo "$(date) $MODE already running"; exit 0; }
echo "=== $(date) $MODE"

[ -d "$BOT/.git" ] || git clone -q "$REPO" "$BOT" || exit 1
cd "$BOT" || exit 1
sync_main() { git fetch -q origin main && git checkout -q -B main origin/main && git reset -q --hard origin/main; }

push_data() {  # push_data "<commit message>": commit data/ changes, if any, and push them
  git add -A data
  git diff --staged --quiet && { echo "$1: nothing new"; return 0; }
  git -c user.name="patinoire-bot" -c user.email="patinoire-bot@users.noreply.github.com" commit -qm "$1"
  for _ in 1 2 3; do git pull -q --rebase origin main && git push -q origin main && { echo "$1: pushed"; return 0; }; sleep 30; done
  echo "$1: push failed"; return 1
}

standings() {
  sync_main || return 1
  python3 scripts/update_pool.py && { python3 scripts/insights.py || echo "warning: gazette update failed"; }
  push_data "Auto-update pool stats ($MODE, local backup)"
}

if [ "$MODE" = night ]; then
  OUT="$BOT-live-out"
  # Give up at 4 AM; the morning job takes it from there
  until [ "$(date +%H)" -ge 4 ] && [ "$(date +%H)" -lt 12 ]; do
    sync_main
    rm -rf "$OUT"; git worktree prune
    if git fetch -q origin live; then git worktree add -q --detach "$OUT" origin/live
    else git worktree add -q --detach "$OUT" && git -C "$OUT" checkout -q --orphan live-tmp && git -C "$OUT" rm -rfq .; fi
    out=$(python3 scripts/update_live.py --loop --out "$OUT" 2>&1); echo "$out"
    git worktree remove --force "$OUT"
    if grep -q "No games left" <<<"$out"; then
      # Only after midnight UTC, like the GitHub job, so "since yesterday" stays on the right day
      [ "$(date -u +%H)" -lt 12 ] && standings
      break
    fi
    sleep 900
  done
else
  standings
  # Claude's front-page recap of last night (scripts/recap.py); a failure only skips the recap
  python3 scripts/recap.py && push_data "Morning recap"
fi
echo "=== $(date) $MODE done"
