#!/usr/bin/env python3
"""Tonight's games for the "Ce soir" tab (live.json).

The NHL score API has no CORS headers, so the browser can't call it directly; this script
relays it. GitHub's scheduled runs are best-effort (often hours late), so on game nights
live-scores.yml starts this once and it keeps running:

  python scripts/update_live.py                       # one update -> data/live.json (local testing)
  python scripts/update_live.py --loop --out live-out # game-night loop used by live-scores.yml
  python scripts/update_live.py --day 2026-10-16      # a past night (testing the bingo, see js/bingo.js)

In loop mode it refreshes every 2 minutes until every game of the night is final (or ~5.5 h),
and publishes each change by force-pushing a single-commit `live` branch from the --out
worktree. Keeping live data off `main` avoids a Pages rebuild every 2 minutes; the site reads
live.json straight from that branch.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from history import game_day_now
from pool_lib import DATA_DIR, get_json, load, now_iso

REFRESH = 120            # seconds between updates while games are on
IDLE_WAIT = 300          # seconds between checks before the first puck drop
MAX_RUNTIME = 5.5 * 3600  # GitHub jobs stop at 6 h
DONE_STATES = {"OFF", "FINAL"}


def build_live(day=None):
    day = day or game_day_now()
    data = get_json(f"https://api-web.nhle.com/v1/score/{day}") or {"games": []}
    pool_ids = {p["id"] for g in load("groups.json", []) for p in g["players"]}
    pool_ids |= {p["id"] for r in load("rosters.json", []) for p in r["players"]}

    games, players, goals = [], {}, []
    for g in data.get("games", []):
        games.append({
            "id": g["id"],
            "state": g["gameState"],  # FUT, PRE, LIVE, CRIT, FINAL, OFF
            "start": g["startTimeUTC"],
            "away": {"abbrev": g["awayTeam"]["abbrev"], "score": g["awayTeam"].get("score")},
            "home": {"abbrev": g["homeTeam"]["abbrev"], "score": g["homeTeam"].get("score")},
            "period": g.get("periodDescriptor", {}).get("number"),
            "periodType": g.get("periodDescriptor", {}).get("periodType"),
            "clock": g.get("clock", {}).get("timeRemaining"),
            "intermission": g.get("clock", {}).get("inIntermission", False),
        })
        for goal in g.get("goals", []):
            if goal.get("periodDescriptor", {}).get("periodType") == "SO":
                continue  # shootout goals don't count as goals
            # Every goal of the night, for the bingo squares
            goals.append({
                "gameId": g["id"], "team": goal.get("teamAbbrev"), "playerId": goal["playerId"],
                "assistIds": [a["playerId"] for a in goal.get("assists", [])],
                "period": goal.get("periodDescriptor", {}).get("number"),
                "periodType": goal.get("periodDescriptor", {}).get("periodType"),
                "time": goal.get("timeInPeriod"), "strength": goal.get("strength"),
                "emptyNet": goal.get("goalModifier") == "empty-net",
            })
            involved = [(goal["playerId"], "goals")] + [(a["playerId"], "assists") for a in goal.get("assists", [])]
            for pid, kind in involved:
                if pid in pool_ids:
                    line = players.setdefault(str(pid), {"goals": 0, "assists": 0, "gameId": g["id"]})
                    line[kind] += 1
    return {"gameDay": day, "games": games, "players": players, "goals": goals}


def write(path, live):
    path.write_text(json.dumps({"updated": now_iso(), **live}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def publish(out_dir):
    """Replace the `live` branch with a single commit holding the new live.json."""
    git = lambda *args: subprocess.run(["git", "-C", str(out_dir), *args], check=True, capture_output=True)
    git("add", "live.json")
    has_commit = subprocess.run(["git", "-C", str(out_dir), "rev-parse", "--verify", "HEAD"],
                                capture_output=True).returncode == 0
    git("commit", "-q", "-m", "Live scores", *(["--amend"] if has_commit else []))
    git("push", "-q", "-f", "origin", "HEAD:live")


def seconds_to_first_puck(games):
    now = datetime.now(timezone.utc)
    starts = [datetime.fromisoformat(g["start"].replace("Z", "+00:00")) for g in games if g["state"] in ("FUT", "PRE")]
    return min((s - now).total_seconds() for s in starts) if starts else 0


def loop(out_dir):
    out_dir = Path(out_dir)
    began, last, saw_live = time.monotonic(), None, False
    while True:
        try:
            live = build_live()
        except Exception as e:  # a hiccup at the NHL API shouldn't end the night
            print(f"warning: {e}")
            time.sleep(REFRESH)
            continue
        if live != last:
            write(out_dir / "live.json", live)
            publish(out_dir)
            last = live
            on = sum(g["state"] in ("LIVE", "CRIT") for g in live["games"])
            print(f"{now_iso()} published: {len(live['games'])} games, {on} live, {len(live['players'])} pool players scored")

        games = live["games"]
        saw_live = saw_live or any(g["state"] in ("LIVE", "CRIT") for g in games)
        if not games or all(g["state"] in DONE_STATES for g in games):
            print("No games left tonight. Done.")
            # Tell the workflow to rebuild the standings now rather than wait for the morning job
            if saw_live and os.environ.get("GITHUB_OUTPUT"):
                with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                    f.write("night_over=true\n")
            return
        if time.monotonic() - began > MAX_RUNTIME:
            print("Time limit reached; the next scheduled run takes over.")
            return
        wait_first = seconds_to_first_puck(games)
        if not any(g["state"] in ("LIVE", "CRIT") for g in games) and wait_first > 3 * 3600:
            print("First game is more than 3 h away; a later scheduled run will pick it up.")
            return
        time.sleep(IDLE_WAIT if wait_first > 15 * 60 and not any(g["state"] in ("LIVE", "CRIT") for g in games) else REFRESH)


def main(args):
    if "--loop" in args:
        loop(args[args.index("--out") + 1] if "--out" in args else "live-out")
        return
    live = build_live(args[args.index("--day") + 1] if "--day" in args else None)
    write(DATA_DIR / "live.json", live)
    print(f"live.json: {len(live['games'])} games, {len(live['players'])} pool players with points.")


if __name__ == "__main__":
    main(sys.argv[1:])
