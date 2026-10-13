#!/usr/bin/env python3
"""One-time import of the draft.

1. scripts/form_rounds_2026-27.txt (the 21 rounds of the Google Form) -> data/groups.json
2. roster_2027.txt (participant, team name, one pick per group) -> data/rosters.json

Players are written "Name (TEAM)" and resolved to NHL player IDs.
Unresolvable names go in scripts/roster_overrides.json as {"Name (TEAM)": player_id}.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import requests

from pool_lib import ROOT, fetch_season_stats, load, save

HERE = Path(__file__).parent
SHEET = HERE / "form_rounds_2026-27.txt"
OVERRIDES = HERE / "roster_overrides.json"
SEARCH_URL = "https://search.d3.nhle.com/api/v1/search/player"

# Abbreviations used in the pool sheet -> official NHL codes
TEAM_FIX = {"MON": "MTL", "TB": "TBL", "NJ": "NJD", "LA": "LAK", "WAS": "WSH", "UTAH": "UTA",
            "CLS": "CBJ", "SJ": "SJS", "VEG": "VGK", "ANH": "ANA"}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().strip()
    return "usr_" + re.sub(r"[^a-z]+", "_", s).strip("_")


def parse_cell(cell):
    m = re.match(r"^(.*?)\s*\(([A-Z]+)\)\s*$", cell.strip())
    if not m:
        raise ValueError(f"Cannot parse player cell: {cell!r}")
    return m.group(1).strip(), TEAM_FIX.get(m.group(2), m.group(2))


def parse_sheet():
    groups, current = [], None
    for line in SHEET.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^\[(\d+) ([FDG])\]$", line)
        if m:
            current = {"group": int(m.group(1)), "pos": m.group(2), "cells": []}
            groups.append(current)
        else:
            current["cells"].append(line)
    return groups


def search_player(name, pos, team):
    res = requests.get(SEARCH_URL, params={"culture": "en-us", "limit": 20, "q": name}, timeout=20)
    res.raise_for_status()
    hits = [h for h in res.json() if norm(h["name"]) == norm(name)
            and (h["positionCode"] == "G") == (pos == "G")]
    if len(hits) > 1:
        hits = [h for h in hits if (h["positionCode"] == "D") == (pos == "D")] or hits
    if len(hits) > 1:
        hits = [h for h in hits if h.get("active")] or hits
    if len(hits) > 1:
        hits = [h for h in hits if team in (h.get("teamAbbrev"), h.get("lastTeamAbbrev"))] or hits
    return hits[0] if len(hits) == 1 else None


def resolve(cell, pos, by_name, overrides, notes):
    name, team = parse_cell(cell)
    key = f"{name} ({team})"
    if cell in overrides or key in overrides:
        pid = overrides.get(cell) or overrides[key]
        notes.append(f"override {cell} -> {pid}")
        return {"id": int(pid), "name": name, "team": team}

    candidates = [(pid, p) for pid, p in by_name.get(norm(name), [])
                  if (p["pos"] == "G") == (pos == "G")]
    if len(candidates) > 1:
        candidates = [c for c in candidates if c[1]["pos"] == pos] or candidates
    if len(candidates) > 1:
        candidates = [c for c in candidates if c[1]["team"] == team] or candidates
    if len(candidates) == 1:
        pid, p = candidates[0]
        if p["team"] != team:
            notes.append(f"{cell}: sheet says {team}, NHL now says {p['team']}")
        return {"id": int(pid), "name": p["name"], "team": p["team"]}

    hit = search_player(name, pos, team)
    if hit:
        notes.append(f"{cell}: no games yet this season, resolved via search -> {hit['playerId']}")
        return {"id": int(hit["playerId"]), "name": hit["name"],
                "team": hit.get("teamAbbrev") or hit.get("lastTeamAbbrev") or team}
    return None


def main():
    config = load("config.json")
    season_players = fetch_season_stats(config["season"])
    by_name = {}
    for pid, p in season_players.items():
        by_name.setdefault(norm(p["name"]), []).append((pid, p))
    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    notes, problems = [], []

    # 1. Groups from the pool sheet
    groups = []
    cell_to_player = {}  # norm(name) -> (group number, player)
    for g in parse_sheet():
        players = []
        for cell in g["cells"]:
            p = resolve(cell, g["pos"], by_name, overrides, notes)
            if not p:
                problems.append(f"group {g['group']}: {cell}")
                continue
            players.append(p)
            cell_to_player[norm(parse_cell(cell)[0])] = (g["group"], p)
        groups.append({"group": g["group"], "pos": g["pos"], "players": players})
    if len(groups) != 21:
        sys.exit(f"Expected 21 groups, found {len(groups)}")

    # 2. Participant picks, matched by name to the sheet
    rosters = []
    lines = (ROOT / "roster_2027.txt").read_text(encoding="utf-8").splitlines()
    for line in lines[1:]:
        if not line.strip():
            continue
        cells = [c.strip() for c in line.split("\t")]
        participant, team_name, picks = cells[0], cells[1], cells[2:]
        players = []
        for cell in picks:
            match = cell_to_player.get(norm(parse_cell(cell)[0]))
            if not match:
                problems.append(f"{participant}: {cell} is not in any round of the form")
                continue
            group, p = match
            players.append({"id": p["id"], "name": p["name"], "pos": groups[group - 1]["pos"],
                            "team": p["team"], "group": group, "baseline": None})
        picked = sorted(p["group"] for p in players)
        if picked != list(range(1, 22)):
            problems.append(f"{participant}: not exactly one pick per round "
                            f"(missing {sorted(set(range(1, 22)) - set(picked))})")
        rosters.append({
            "participantId": slug(participant),
            "participantName": participant,
            "teamName": team_name,
            "tradesUsed": {"F": 0, "D": 0, "G": 0},
            "players": sorted(players, key=lambda p: p["group"]),
            "formerPlayers": [],
        })

    for n in notes:
        print("note:", n)
    if problems:
        print("\nProblems:")
        for p in problems:
            print("  ", p)
        sys.exit(1)
    save("groups.json", groups)
    save("rosters.json", rosters)
    print(f"Wrote {len(groups)} groups ({sum(len(g['players']) for g in groups)} players) "
          f"and {len(rosters)} rosters.")


if __name__ == "__main__":
    main()
