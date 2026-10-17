#!/usr/bin/env python3
"""Injured pool players: data/injuries.json, for the "Blessés" tab and the bingo.

The NHL's public API has no injury list, so this reads ESPN's public NHL injury feed and keeps the
players of the pool (every player of the draft rounds, picked or not), matched by name. Statuses:
  ir    injured reserve        out   ruled out
  susp  suspended              dtd   day-to-day
Every injured player is left off the bingo cards, day-to-day included.

Run by insights.py (each morning and after the last game). update_live.py also calls out_ids()
for a game day's first live.json, so that day's bingo cards leave out players who won't play.
"""
import sys

from build_rosters import norm
from pool_lib import get_json, load, now_iso, save

URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries"
STATUS = {"Injured Reserve": "ir", "Out": "out", "Day-To-Day": "dtd"}


def pool_players():
    """{normalized name: player} for every player the pool can own."""
    players = {}
    for g in load("groups.json", []):
        for p in g["players"]:
            players[norm(p["name"])] = {"id": p["id"], "name": p["name"], "team": p.get("team"), "pos": g["pos"]}
    for r in load("rosters.json", []):  # traded-in players outside the draft lists
        for p in r["players"]:
            players.setdefault(norm(p["name"]), {"id": p["id"], "name": p["name"], "team": p.get("team"), "pos": p["pos"]})
    return players


def fetch():
    """The pool's injured players, most serious first."""
    data = get_json(URL) or {}
    pool, out = pool_players(), []
    for team in data.get("injuries", []):
        for i in team.get("injuries", []):
            p = pool.get(norm(i.get("athlete", {}).get("displayName", "")))
            if not p:
                continue
            details = i.get("details", {})
            status = "susp" if details.get("type") == "Suspension" else STATUS.get(i.get("status"), "dtd")
            out.append({**p, "status": status, "type": details.get("type"), "returnDate": details.get("returnDate"),
                        "noteDate": (i.get("date") or "")[:10], "note": i.get("shortComment") or ""})
    order = ["susp", "ir", "out", "dtd"]
    return sorted(out, key=lambda x: (order.index(x["status"]), x["name"]))


def out_ids(injured):
    """Ids left off the bingo cards: every injured or suspended player."""
    return sorted(x["id"] for x in injured)


def build():
    injured = fetch()
    save("injuries.json", {"updated": now_iso(), "source": "ESPN", "players": injured})
    print(f"injuries.json: {len(injured)} pool players injured or suspended")


if __name__ == "__main__":
    build()
    sys.exit(0)
