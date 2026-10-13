#!/usr/bin/env python3
"""Daily points history for the trajectory chart: data/history.json

  {"dates": ["2026-10-07", ...], "series": {participantId: [cumulative points per date]}}

`python scripts/history.py --backfill` rebuilds it from player game logs (one call per
rostered player). The daily run then just records the current totals via record().
"""
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from pool_lib import get_json, load, save, score

EASTERN = ZoneInfo("America/Toronto")


def game_day_now():
    """NHL 'game day' in Eastern time; before noon we're still recording last night's games."""
    now = datetime.now(EASTERN)
    return (now - timedelta(hours=12)).date().isoformat()


def last_completed_day():
    """The morning run records last night's games; any later run updates that same day."""
    return (datetime.now(EASTERN) - timedelta(days=1)).date().isoformat()


def record(standings, day=None):
    day = day or last_completed_day()
    hist = load("history.json", {"dates": [], "series": {}})
    if day not in hist["dates"]:
        hist["dates"].append(day)
        hist["dates"].sort()
    idx = hist["dates"].index(day)
    for s in standings:
        series = hist["series"].setdefault(s["participantId"], [])
        series.extend([None] * (len(hist["dates"]) - len(series)))
        if len(series) > len(hist["dates"]):  # a date was inserted before the end
            series.insert(idx, None)
        series[idx] = s["totalPoints"]
    save("history.json", hist)


def backfill():
    config = load("config.json")
    rosters = load("rosters.json")
    scoring = config["scoring"]
    season = config["season"]
    if any(r.get("formerPlayers") for r in rosters):
        sys.exit("Backfill assumes no trades yet; trades exist, keep the recorded history.")

    per_player_day = {}  # player id -> {date: points}
    ids = {(p["id"], p["pos"]) for r in rosters for p in r["players"]}
    for pid, pos in sorted(ids):
        log = get_json(f"https://api-web.nhle.com/v1/player/{pid}/game-log/{season}/2") or {}
        days = defaultdict(int)
        for g in log.get("gameLog", []):
            line = {"goals": g.get("goals", 0), "assists": g.get("assists", 0),
                    "wins": 1 if g.get("decision") == "W" else 0,
                    "otl": 1 if g.get("decision") == "O" else 0,
                    "shutouts": g.get("shutouts", 0), "soGoals": 0}
            days[g["gameDate"]] += score(line, pos, scoring)
        per_player_day[pid] = days
        time.sleep(0.5)  # be gentle with the NHL API

    all_days = sorted({d for days in per_player_day.values() for d in days})
    hist = {"dates": all_days, "series": {}}
    for r in rosters:
        total, series = 0, []
        for d in all_days:
            total += sum(per_player_day[p["id"]].get(d, 0) for p in r["players"])
            series.append(total)
        hist["series"][r["participantId"]] = series
    save("history.json", hist)
    print(f"History backfilled: {len(all_days)} game days, {len(ids)} players.")


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    else:
        print(__doc__)
