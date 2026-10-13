#!/usr/bin/env python3
"""Tonight's games for the "Ce soir" tab: data/live.json

Run every ~15 min during game hours by .github/workflows/live-scores.yml.
The NHL score API has no CORS headers, so the browser can't call it directly.
Only writes the file when something changed, so quiet runs make no commit.
"""
from history import game_day_now
from pool_lib import get_json, load, now_iso, save


def build_live():
    day = game_day_now()
    data = get_json(f"https://api-web.nhle.com/v1/score/{day}") or {"games": []}
    pool_ids = {p["id"] for g in load("groups.json", []) for p in g["players"]}
    pool_ids |= {p["id"] for r in load("rosters.json", []) for p in r["players"]}

    games, players = [], {}
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
            involved = [(goal["playerId"], "goals")] + [(a["playerId"], "assists") for a in goal.get("assists", [])]
            for pid, kind in involved:
                if pid in pool_ids:
                    line = players.setdefault(str(pid), {"goals": 0, "assists": 0, "gameId": g["id"]})
                    line[kind] += 1

    live = {"gameDay": day, "games": games, "players": players}
    old = load("live.json", {}) or {}
    if {k: old.get(k) for k in live} == live:
        print("No change.")
        return
    save("live.json", {"updated": now_iso(), **live})
    print(f"live.json: {len(games)} games, {len(players)} pool players with points.")


if __name__ == "__main__":
    build_live()
