#!/bin/bash
# The overseer: every 30 minutes (Windows Task Scheduler, see README.md here), check that the site
# is up to date (scripts/healthcheck.py) and re-run whatever job fell behind:
#   standings  -> pool_job.sh standings      recap -> pool_job.sh morning (standings, then recap)
#   live       -> pool_job.sh night from noon to 4 AM, or one live pass otherwise
# A problem still there on the next check (the repair didn't work), or one no job can fix (the
# Pages deploy, GitHub unreachable), goes to Hugo's phone through ntfy, once; then "fixed" when it
# clears. The ntfy topic lives in ~/pool_patinoire_ntfy.txt, outside the repo.
set -u
BOT=${POOL_BOT_DIR:-$HOME/patinoire-bot}
JOB=$HOME/.local/bin/patinoire_job.sh
CHECK_DIR=$HOME/patinoire-overseer            # its own small clone, so it never waits on the jobs' clone
STATE=$HOME/.patinoire-overseer.state         # problems seen on the last check, and which were sent
TOPIC_FILE=$HOME/pool_patinoire_ntfy.txt
exec >>"$BOT-overseer.log" 2>&1
exec 9>"$BOT-overseer.lock"
flock -n 9 || exit 0

notify() {  # notify <title> <message> [priority]
  [ -s "$TOPIC_FILE" ] || { echo "no ntfy topic: $1 — $2"; return; }
  curl -s -o /dev/null -m 20 -H "Title: $1" -H "Priority: ${3:-high}" -H "Tags: hockey" \
    -d "$2" "https://ntfy.sh/$(tr -d '[:space:]' <"$TOPIC_FILE")" || echo "ntfy failed"
}

if [ -d "$CHECK_DIR/.git" ]; then git -C "$CHECK_DIR" fetch -q --depth 1 origin main && git -C "$CHECK_DIR" reset -q --hard origin/main
else git clone -q --depth 1 https://github.com/hberube/patinoire.git "$CHECK_DIR"; fi || { echo "$(date) can't reach GitHub"; exit 0; }

report=$(python3 "$CHECK_DIR/scripts/healthcheck.py" --json) || true
[ -n "$report" ] || { echo "$(date) healthcheck crashed"; exit 0; }
problems=$(python3 -c 'import json,sys; [print(p["key"], p["fix"], p["text"], sep="\t") for p in json.loads(sys.argv[1])["problems"]]' "$report")

# Repairs, at most one per kind of job (they run in the background: a live pass lasts all night)
declare -A started=()
while IFS=$'\t' read -r key fix text; do
  [ -n "$key" ] || continue
  echo "$(date) ✗ $text"
  [ -n "${started[$fix]:-}" ] && continue
  # Once Hugo has been told the recap is failing, stop calling Claude every 30 minutes for it
  [ "$fix" = recap ] && grep -qP "^\Q$key\E\tsent" "$STATE" 2>/dev/null && continue
  hour=$(date +%-H)
  case "$fix" in
    standings) mode=standings ;;
    recap) mode=morning ;;
    live) if [ "$hour" -ge 12 ] || [ "$hour" -lt 4 ]; then mode=night; else mode=live; fi ;;
    *) continue ;;  # nothing on this PC can fix it: alert right away
  esac
  started[$fix]=1
  echo "$(date) repair: pool_job.sh $mode"
  setsid nohup bash "$JOB" "$mode" </dev/null >/dev/null 2>&1 &
done <<<"$problems"

# Alerts: a problem seen on the last check too (the repair had its chance), or one with no repair
touch "$STATE"
next=""
while IFS=$'\t' read -r key fix text; do
  [ -n "$key" ] || continue
  last=$(grep -P "^\Q$key\E\t" "$STATE" | cut -f2)
  sent=$([ "$last" = sent ] && echo sent || echo seen)
  if [ "$sent" = seen ] && { [ -n "$last" ] || [ "$fix" = site ]; }; then
    notify "Pool: à vérifier" "$text"
    sent=sent
  fi
  next+="$key"$'\t'"$sent"$'\t'"$text"$'\n'
done <<<"$problems"
# Problems that cleared after an alert
while IFS=$'\t' read -r key status text; do
  [ "$status" = sent ] || continue
  grep -qP "^\Q$key\E\t" <<<"$next" || notify "Pool: réglé ✅" "$text — c'est réglé" default
done <"$STATE"
printf '%s' "$next" >"$STATE"
[ -z "$problems" ] && echo "$(date) ✓ all good"
exit 0
