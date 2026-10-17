#!/usr/bin/env python3
"""Keeps each finished bingo night for good: data/bingo.json

The site draws and scores the bingo cards in the browser (js/bingo.js) from a night's games and
goals plus each participant's roster. live.json only holds the current night, so once all of a
night's games are final this saves those inputs; the site replays every saved night with the same
code to show yesterday's winner and count bingo wins in the trophy case. Rosters are saved with
the night (only when they changed since the previous one), so a later trade or a new participant
never rewrites an old night's result.

Run by insights.py after each standings rebuild (it's a no-op until the night is over).
  python scripts/bingo_archive.py 2026-10-17    # one night by hand
"""
import json
import sys

from pool_lib import DATA_DIR, get_json, load
from update_live import build_live

FIRST_NIGHT = "2026-10-17"  # the bingo's first night: earlier nights were never played
LIVE = "https://raw.githubusercontent.com/hberube/patinoire/live/live.json"
FINAL = {"OFF", "FINAL"}


def rosters_on(nights, day):
    """The rosters in force on `day`: the last ones saved on or before it."""
    current = None
    for n in nights:
        if n["day"] > day:
            break
        current = n.get("rosters", current)
    return current


def archive(day):
    if day < FIRST_NIGHT:
        return False
    live = build_live(day)
    if not live["games"] or not all(g["state"] in FINAL for g in live["games"]):
        return False
    rosters = {s["participantId"]: [[p["id"], p["name"], p["pos"], p["team"]] for p in s["rosterStats"]]
               for s in load("leaderboard.json")["standings"]}
    nights = [n for n in load("bingo.json", {"nights": []})["nights"] if n["day"] != day]
    entry = {
        "day": day,
        "games": [{"id": g["id"], "state": g["state"], "period": g["period"], "periodType": g["periodType"],
                   "away": g["away"], "home": g["home"]} for g in live["games"]],
        # [gameId, team, playerId, assistIds, period, periodType, time, strength, emptyNet]
        "goals": [[x["gameId"], x["team"], x["playerId"], x["assistIds"], x["period"], x["periodType"],
                   x["time"], x["strength"], x["emptyNet"]] for x in live["goals"]],
    }
    # The injured players left off that night's cards, frozen in its live.json (update_live.py)
    published = get_json(LIVE) or {}
    if published.get("gameDay") == day and published.get("out"):
        entry["out"] = published["out"]
    if rosters != rosters_on(nights, day):
        entry["rosters"] = rosters
    nights = sorted([*nights, entry], key=lambda n: n["day"])
    # Compact, one night per line: the file grows all season and loads with the site
    lines = ",\n".join(json.dumps(n, ensure_ascii=False, separators=(",", ":")) for n in nights)
    (DATA_DIR / "bingo.json").write_text(f'{{"nights":[\n{lines}\n]}}\n', encoding="utf-8")
    print(f"bingo.json: {day} saved ({len(entry['goals'])} goals{', new rosters' if 'rosters' in entry else ''})")
    return True


if __name__ == "__main__":
    from history import last_completed_day
    archive(sys.argv[1] if len(sys.argv) > 1 else last_completed_day())
