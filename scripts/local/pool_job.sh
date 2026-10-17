#!/bin/bash
# Backup for GitHub's unreliable schedule, started by Windows Task Scheduler (see README.md here).
#   pool_job.sh night      from noon: keep "Ce soir" live until the last game, then rebuild the standings
#   pool_job.sh morning    early morning: rebuild the standings (and the history chart) if still needed,
#                          then have Claude write the front-page recap (needs ~/.local/bin/claude, logged in)
#   pool_job.sh standings  rebuild the standings and Gazette only     } what overseer.sh runs
#   pool_job.sh live       one pass of the night's live-score loop    } to repair a missed job
# Runs in its own clone so it never touches a working copy. Safe to run alongside the GitHub
# workflows: they all produce the same data, and a second copy of the same job exits right away.
set -u
MODE=${1:?usage: pool_job.sh night|morning|standings|live}
BOT=${POOL_BOT_DIR:-$HOME/patinoire-bot}
REPO=https://github.com/hberube/patinoire.git
LOG=$BOT-$MODE.log
exec >>"$LOG" 2>&1
exec 9>"$BOT-$MODE.lock"
flock -n 9 || { echo "$(date) $MODE already running"; exit 0; }
echo "=== $(date) $MODE"

[ -d "$BOT/.git" ] || git clone -q "$REPO" "$BOT" || exit 1
cd "$BOT" || exit 1
# All modes share this clone: one at a time may reset it, rebuild data or push
# (the night loop only holds it between live passes, not while it waits for games)
exec 8>"$BOT.clone.lock"
hold_clone() { flock 8; }
free_clone() { flock -u 8; }
sync_main() {  # also clears a rebase or merge an earlier run left half done
  git rebase --abort 2>/dev/null; git merge --abort 2>/dev/null
  git fetch -q origin main && git checkout -q -f -B main origin/main && git reset -q --hard origin/main
}

push_data() {  # push_data "<commit message>": commit data/ changes, if any, and push them
  git add -A data
  git diff --staged --quiet && { echo "$1: nothing new"; return 0; }
  git -c user.name="patinoire-bot" -c user.email="patinoire-bot@users.noreply.github.com" commit -qm "$1"
  for _ in 1 2 3; do
    git pull -q --rebase origin main && git push -q origin main && { echo "$1: pushed"; return 0; }
    # A conflict means a GitHub job just pushed the same files from the same NHL data: keep theirs
    if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
      sync_main; echo "$1: another job published the same update first, kept theirs"; return 0
    fi
    sleep 30
  done
  echo "$1: push failed"; return 1
}

standings() {
  hold_clone
  sync_main || { free_clone; return 1; }
  python3 scripts/update_pool.py && { python3 scripts/insights.py || echo "warning: gazette update failed"; }
  push_data "Auto-update pool stats ($MODE, local backup)"
  free_clone
}

# One pass of the live-score loop: runs until every game of the night is final (then rebuilds the
# standings), or exits early when the first puck is more than 3 h away. Returns 0 when the night is over.
live_pass() {
  local OUT="$BOT-live-out" out
  hold_clone
  sync_main
  rm -rf "$OUT"; git worktree prune
  if git fetch -q origin live; then git worktree add -q --detach "$OUT" origin/live
  else git worktree add -q --detach "$OUT" && git -C "$OUT" checkout -q --orphan live-tmp && git -C "$OUT" rm -rfq .; fi
  free_clone
  out=$(python3 scripts/update_live.py --loop --out "$OUT" 2>&1); echo "$out"
  hold_clone; git worktree remove --force "$OUT"; free_clone
  grep -q "No games left" <<<"$out" || return 1
  # Only after midnight UTC, like the GitHub job, so "since yesterday" stays on the right day
  [ "$(date -u +%H)" -lt 12 ] && standings
  return 0
}

recap() {
  # Claude's front-page recap of last night (scripts/recap.py); a failure only skips the recap
  # (through uv for Pillow, which draws the meme card; WSL's python3 has no pip)
  hold_clone
  "$HOME/.local/bin/uv" run -q --no-project --with pillow --with requests python3 scripts/recap.py \
    && push_data "Morning recap"
  # « Les Ondes de la Patinoire »: Claude's radio show of last night (scripts/radio.py), voiced by
  # ElevenLabs (key in ~/pool_patinoire_elevenlabs.txt) or the free voices; skipped when switched off
  python3 -c 'import json,sys; sys.exit(json.load(open("data/config.json")).get("features",{}).get("radio") is False)' \
    && "$HOME/.local/bin/uv" run -q --no-project --with edge-tts --with requests python3 scripts/radio.py \
    && push_data "Morning radio show"
  free_clone
}

case "$MODE" in
  night)
    # Give up at 4 AM; the morning job takes it from there
    until [ "$(date +%H)" -ge 4 ] && [ "$(date +%H)" -lt 12 ]; do
      live_pass && break
      sleep 900
    done ;;
  live) live_pass ;;
  standings) standings ;;
  morning) standings; recap ;;
  *) echo "unknown mode $MODE"; exit 2 ;;
esac
echo "=== $(date) $MODE done"
