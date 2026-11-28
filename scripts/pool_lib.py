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


def _fetch(kind, season, report="summary", page=100, through=None):
    """Every row of a stats report. Since late Nov 2026 the API ignores limit=-1 and returns at most
    100 rows, which zeroed every skater outside the top 100, so page through it (sorted by id so the
    pages don't overlap) and fail loudly rather than publish a short list."""
    rows, total = [], None
    sort = json.dumps([{"property": "playerId", "direction": "ASC"}])
    where = f"seasonId={season} and gameTypeId=2"
    if through:  # only games up to that date (YYYY-MM-DD), e.g. to leave tonight's games out
        where += f' and gameDate<="{through} 23:59:59"'
    while total is None or len(rows) < total:
        params = {"limit": page, "start": len(rows), "sort": sort,
                  "cayenneExp": where}
        data = get_json(STATS_URL.format(kind=kind, report=report), params)
        batch, total = data["data"], data.get("total", 0)
        if not batch:
            break
        rows += batch
    if total and len(rows) < total:
        raise RuntimeError(f"{kind} {report}: got {len(rows)} of {total} rows from the NHL stats API")
    return rows


def fetch_season_stats(season, through=None):
    """Returns {player_id(str): {name, pos, team, gp, goals, assists, soGoals, wins, shutouts, otl}}
    for every player who has played a regular-season game this season (3 API calls)."""
    players = {}
    for row in _fetch("skater", season, through=through):
        players[str(row["playerId"])] = {
            "name": row["skaterFullName"],
            "pos": "D" if row["positionCode"] == "D" else "F",
            "team": row["teamAbbrevs"].split(",")[-1].strip(),
            "gp": row["gamesPlayed"],
            "goals": row["goals"],
            "assists": row["assists"],
            "soGoals": 0, "wins": 0, "shutouts": 0, "otl": 0,
        }
    for row in _fetch("goalie", season, through=through):
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
        for row in _fetch("skater", season, report="shootout", through=through):
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


def game_line(g):
    """One game-log entry as a pool stat line."""
    return {"goals": g.get("goals", 0), "assists": g.get("assists", 0), "soGoals": 0,
            "wins": 1 if g.get("decision") == "W" else 0,
            "otl": 1 if g.get("decision") == "O" else 0,
            "shutouts": g.get("shutouts", 0)}


def fetch_game_logs(player_ids, season):
    """{player id: [games, oldest first]}: one call per player, paced for the NHL API."""
    logs = {}
    for pid in sorted(player_ids):
        data = get_json(f"https://api-web.nhle.com/v1/player/{pid}/game-log/{season}/2") or {}
        logs[pid] = sorted(data.get("gameLog", []), key=lambda g: g["gameDate"])
        time.sleep(0.4)
    return logs
