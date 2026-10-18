#!/usr/bin/env python3
"""Facts shared by the morning recap (recap.py, its meme) and the radio show (radio.py) that only
the site's own code knows: the bingo results, and the standings in the site's order (equal points
split by season bingo lines, then goals). Runs js/bingo.js with Node through scripts/bingo_night.mjs.
"""
import json
import shutil
import subprocess
from pathlib import Path

from pool_lib import DATA_DIR, ROOT, load

WINDOWS_NODE = "/mnt/c/Program Files/nodejs/node.exe"  # Hugo's PC: WSL has no Node of its own


def bingo_facts(day):
    """Last night's bingo and the season race, from the site's own card code (scripts/bingo_night.mjs)."""
    node = shutil.which("node") or (WINDOWS_NODE if Path(WINDOWS_NODE).exists() else None)
    if not node:
        raise RuntimeError("no Node to run the bingo")
    win = node.endswith(".exe")

    def path(p):
        return subprocess.run(["wslpath", "-w", str(p)], capture_output=True, text=True).stdout.strip() if win else str(p)

    run = subprocess.run([node, path(ROOT / "scripts" / "bingo_night.mjs"), path(DATA_DIR.parent), day],
                         capture_output=True, text=True, timeout=120)
    if run.returncode != 0:
        raise RuntimeError(f"bingo_night: {run.stderr[-300:]}")
    return json.loads(run.stdout)


def site_order(standings, lines):
    """The standings in the site's order: equal points are split by season bingo lines, then goals
    (applyBingoTiebreak in js/app.js), so the show never contradicts the Classement tab."""
    board = {s["participantId"]: s for s in load("leaderboard.json")["standings"]}
    by_who = {f'{s["participantName"].split(" ")[0]} ({s["teamName"]})': s for s in board.values()}
    rows = []
    for row in standings:
        s = by_who.get(row["who"])
        if not s:
            return standings  # names don't line up: keep the recap's order rather than guess
        rows.append((row, s["totalPoints"], lines.get(s["participantId"], 0), s["totalGoals"], s.get("previousRank")))
    rows.sort(key=lambda r: (-r[1], -r[2], -r[3]))
    out = []
    for i, (row, pts, ln, goals, prev) in enumerate(rows):
        same = i and (pts, ln, goals) == rows[i - 1][1:4]
        rank = out[-1]["rank"] if same else i + 1
        out.append({**row, "rank": rank, "rankChange": (prev - rank) if prev else 0, "bingoLinesSeason": ln})
    return out


def injury_facts(before):
    """The injury report since the previous show: new, worse or better (status changed), back in the
    lineup, still out (with teams). `before` is {player id: status} from the previous show.
    Returns (facts, {id: status} today) so the next show can compare."""
    board = load("leaderboard.json")["standings"]
    owners, names = {}, {}
    for s in board:
        for p in s["rosterStats"]:
            owners.setdefault(p["id"], []).append(f'{s["participantName"].split(" ")[0]} ({s["teamName"]})')
            names[p["id"]] = f'{p["name"]} ({p["team"]})'
    status = {"ir": "liste des blessés", "out": "absent", "susp": "suspendu", "dtd": "incertain (au jour le jour)"}
    now = [p for p in (load("injuries.json", {}) or {}).get("players", []) if p["id"] in owners]

    def card(p):
        who = owners[p["id"]]
        return {"id": p["id"], "player": p["name"], "nhlTeam": p["team"], "status": status.get(p["status"], p["status"]),
                "injury": p.get("type"), "expectedBack": p.get("returnDate"),
                "ownedBy": who if len(who) <= 4 else f"{len(who)} participants"}

    today = {str(p["id"]): p["status"] for p in now}
    if before is None:  # no earlier show to compare with: everything counts as news
        return {"new": [card(p) for p in now], "statusChanged": [], "backInLineup": [], "stillOut": []}, today
    changed = [{**card(p), "was": status.get(before[str(p["id"])], before[str(p["id"])])}
               for p in now if str(p["id"]) in before and before[str(p["id"])] != p["status"]]
    return {"new": [card(p) for p in now if str(p["id"]) not in before],
            "statusChanged": changed,
            "backInLineup": [names[int(i)] for i in before if i not in today and int(i) in names],
            "stillOut": [f'{p["name"]} ({p["team"]})' for p in now if before.get(str(p["id"])) == p["status"]]}, today
