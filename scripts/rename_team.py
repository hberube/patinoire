#!/usr/bin/env python3
"""Rename a team (and optionally the participant's display name), nothing else changes.

Usage:
  python scripts/rename_team.py usr_eve --team "Les Nouvelles Étoiles"
  python scripts/rename_team.py usr_eve --team "Les Nouvelles Étoiles" --name "Ève"
  (rename-team.yml passes the values through TEAM_NAME / PARTICIPANT_NAME env vars)

Updates rosters.json, leaderboard.json (so the site changes right away, no NHL call needed)
and users.json for the display name. Points, picks, trades and images are untouched.
"""
import os
import re
import sys

from pool_lib import load, save

MAX_LEN = 60


def clean(value, what):
    value = re.sub(r"\s+", " ", value or "").strip()
    if not value:
        return None
    if len(value) > MAX_LEN or any(ord(c) < 32 for c in value):
        sys.exit(f"::error::{what} must be 1-{MAX_LEN} characters on one line.")
    return value


def main(args):
    if not args or not args[0].startswith("usr_"):
        print(__doc__)
        sys.exit(1)
    pid = args[0]
    opts = dict(zip(args[1::2], args[2::2]))
    team = clean(opts.get("--team", os.environ.get("TEAM_NAME")), "Team name")
    name = clean(opts.get("--name", os.environ.get("PARTICIPANT_NAME")), "Participant name")
    if not team and not name:
        sys.exit("::error::Nothing to rename: give a team name and/or a participant name.")

    rosters = load("rosters.json")
    roster = next((r for r in rosters if r["participantId"] == pid), None)
    if not roster:
        sys.exit(f"::error::Unknown participant {pid}.")
    old = (roster["teamName"], roster["participantName"])
    if team:
        roster["teamName"] = team
    if name:
        roster["participantName"] = name
    save("rosters.json", rosters)

    board = load("leaderboard.json")
    for s in board.get("standings", []):
        if s["participantId"] == pid:
            s["teamName"], s["participantName"] = roster["teamName"], roster["participantName"]
    save("leaderboard.json", board)

    if name:
        users = load("users.json", [])
        for u in users:
            if u["participantId"] == pid:
                u["displayName"] = name
        save("users.json", users)

    print(f"{pid}: '{old[0]}' ({old[1]}) -> '{roster['teamName']}' ({roster['participantName']})")


if __name__ == "__main__":
    main(sys.argv[1:])
