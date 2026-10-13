#!/usr/bin/env python3
"""Add late participants from a fresh export of the Google Form, without touching anyone else.

Usage:
  1. Re-export the form responses to roster_2027.txt (same format as before).
  2. python scripts/add_participants.py            # dry run: shows who would be added
     python scripts/add_participants.py --apply    # adds them
  3. Commit and push data/ (the command prints the new PINs: send them privately).

Rules (decided with Hugo): late participants count their players' points for the FULL season,
as if they had joined on time. Existing participants are never changed: their picks, trades,
banked points, images and PINs stay as they are. A second form submission from someone already
in the pool is ignored (picks can't be changed through the form).
"""
import json
import sys
from collections import Counter

import make_pins
from build_rosters import OVERRIDES, norm, parse_cell, read_submissions, slug
from pool_lib import fetch_game_logs, game_line, load, save, score
from update_pool import rebuild_leaderboard


def fail(msg):
    sys.exit(f"Error: {msg}")


def main(apply):
    config, rosters, groups = load("config.json"), load("rosters.json"), load("groups.json")
    existing = {r["participantId"] for r in rosters}
    by_name, by_id = {}, {}  # normalized NHL name / player id -> (group, pos, player)
    for g in groups:
        for p in g["players"]:
            by_name[norm(p["name"])] = by_id[p["id"]] = (g["group"], g["pos"], p)
    # Form spellings that differ from the NHL's (e.g. "Alexander Barkov (FLA)"), same file as the draft import
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}

    newcomers, problems = {}, []
    for participant, team_name, picks in read_submissions():
        pid = slug(participant)
        if pid in existing:
            continue
        players = []
        for cell in picks:
            name, team = parse_cell(cell)
            override = overrides.get(cell.strip()) or overrides.get(f"{name} ({team})")
            hit = by_id.get(int(override)) if override else by_name.get(norm(name))
            if not hit:
                problems.append(f"{participant}: '{cell}' is not in any round of the form")
                continue
            group, pos, p = hit
            players.append({"id": p["id"], "name": p["name"], "pos": pos, "team": p["team"],
                            "group": group, "baseline": None})
        rounds = Counter(p["group"] for p in players)
        if sorted(rounds) != list(range(1, len(groups) + 1)) or max(rounds.values(), default=0) > 1:
            missing = sorted(set(range(1, len(groups) + 1)) - set(rounds))
            doubled = sorted(g for g, n in rounds.items() if n > 1)
            problems.append(f"{participant}: needs exactly one pick per round (missing {missing}, doubled {doubled})")
        # A later submission from the same new person replaces the earlier one
        newcomers[pid] = {
            "participantId": pid, "participantName": participant.strip(), "teamName": team_name.strip(),
            "tradesUsed": {"F": 0, "D": 0, "G": 0},
            "players": sorted(players, key=lambda p: p["group"]), "formerPlayers": [],
        }

    if problems:
        print("Fix these in the form export, then run again:")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    if not newcomers:
        print("No new participants in roster_2027.txt. Nothing to do.")
        return

    for r in newcomers.values():
        print(f"+ {r['participantName']} — {r['teamName']} ({r['participantId']}), {len(r['players'])} picks")
    if not apply:
        print("\nDry run only. Run again with --apply to add them.")
        return

    rosters.extend(newcomers.values())
    save("rosters.json", rosters)

    # Trajectory: fill their series from the season start (full-season rule)
    hist = load("history.json", {"dates": [], "series": {}})
    if hist["dates"]:
        pos_of = {p["id"]: p["pos"] for r in newcomers.values() for p in r["players"]}
        logs = fetch_game_logs(pos_of, config["season"])
        for r in newcomers.values():
            games = [(g["gameDate"], score(game_line(g), p["pos"], config["scoring"]))
                     for p in r["players"] for g in logs.get(p["id"], [])]
            hist["series"][r["participantId"]] = [sum(pts for d, pts in games if d <= day) for day in hist["dates"]]
        save("history.json", hist)

    rebuild_leaderboard()  # also records today's totals in history.json

    print("\nNew PINs (send each person theirs privately; they are not stored anywhere):")
    make_pins.main([])
    print("\nDone. Next: git add data && git commit -m 'Add participants' && git push")
    print("Team images: ask them for a photo and logo (FAQ) and publish them from the admin page.")


if __name__ == "__main__":
    main("--apply" in sys.argv)
