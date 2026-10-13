"""Shared helpers for the La Patinoire pool scripts."""
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("POOL_DATA_DIR", ROOT / "data"))

STATS_URL = "https://api.nhle.com/stats/rest/en/{kind}/{report}"
STAT_KEYS = ("goals", "assists", "soGoals", "wins", "shutouts", "otl")
EMPTY_STATS = {k: 0 for k in STAT_KEYS}


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load(name, default=None):
    path = DATA_DIR / name
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(name, data):
    with open(DATA_DIR / name, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def get_json(url, params=None, tries=6):
    """GET with retries: the NHL APIs rate-limit (429) and occasionally return an empty body."""
    for attempt in range(tries):
        wait = min(2 ** attempt, 30)
        try:
            res = requests.get(url, params=params, timeout=30)
            if res.status_code == 404:
                return None
            if res.status_code == 429:
                wait = int(res.headers.get("Retry-After", 0) or 0) or max(wait, 10)
            res.raise_for_status()
            return res.json()
        except (requests.RequestException, ValueError):
            if attempt == tries - 1:
                raise
            time.sleep(wait)


def _fetch(kind, season, report="summary"):
    params = {"limit": -1, "cayenneExp": f"seasonId={season} and gameTypeId=2"}
    return get_json(STATS_URL.format(kind=kind, report=report), params)["data"]


def fetch_season_stats(season):
    """Returns {player_id(str): {name, pos, team, gp, goals, assists, soGoals, wins, shutouts, otl}}
    for every player who has played a regular-season game this season (3 API calls)."""
    players = {}
    for row in _fetch("skater", season):
        players[str(row["playerId"])] = {
            "name": row["skaterFullName"],
            "pos": "D" if row["positionCode"] == "D" else "F",
            "team": row["teamAbbrevs"].split(",")[-1].strip(),
            "gp": row["gamesPlayed"],
            "goals": row["goals"],
            "assists": row["assists"],
            "soGoals": 0, "wins": 0, "shutouts": 0, "otl": 0,
        }
    for row in _fetch("goalie", season):
        players[str(row["playerId"])] = {
            "name": row["goalieFullName"],
            "pos": "G",
            "team": row["teamAbbrevs"].split(",")[-1].strip(),
            "gp": row["gamesPlayed"],
            "goals": row["goals"],
            "assists": row["assists"],
            "soGoals": 0,
            "wins": row["wins"],
            "shutouts": row["shutouts"],
            "otl": row["otLosses"] or 0,
        }
    try:  # only matters if config.scoring weights soGoals; never fail the run over it
        for row in _fetch("skater", season, report="shootout"):
            if str(row["playerId"]) in players:
                players[str(row["playerId"])]["soGoals"] = row["shootoutGoals"] or 0
    except requests.RequestException as e:
        print(f"warning: shootout stats unavailable ({e})")
    return players


def raw_stats(season_players, player_id):
    p = season_players.get(str(player_id))
    return {k: p[k] for k in STAT_KEYS} if p else dict(EMPTY_STATS)


def diff_stats(current, baseline):
    baseline = baseline or EMPTY_STATS
    return {k: max(0, current.get(k, 0) - baseline.get(k, 0)) for k in STAT_KEYS}


def weights(pos, scoring):
    """Point value of each stat for a position, from config.scoring.skater / .goalie."""
    return scoring["goalie" if pos == "G" else "skater"]


def score(stats, pos, scoring):
    """Pool points for a stat line; stats missing from the position's weights score 0."""
    w = weights(pos, scoring)
    return sum(stats.get(k, 0) * w.get(k, 0) for k in STAT_KEYS)


def pool_line(stats, pos, scoring):
    """A stat line plus its pool points, as stored in the leaderboard."""
    return {**stats, "points": score(stats, pos, scoring)}


def lookup_player(player_id):
    """Bio lookup for a player with no games yet this season (e.g. injured, just called up)."""
    d = get_json(f"https://api-web.nhle.com/v1/player/{player_id}/landing")
    if not d or not d.get("isActive"):
        return None
    code = d.get("position", "")
    return {
        "name": f"{d['firstName']['default']} {d['lastName']['default']}",
        "pos": "G" if code == "G" else "D" if code == "D" else "F",
        "team": d.get("currentTeamAbbrev", ""),
        "gp": 0, **EMPTY_STATS,
    }
