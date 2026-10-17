#!/usr/bin/env python3
"""Chances of winning the pool, by simulating the rest of the season.

Each rostered player keeps scoring at his pace per game of his NHL team (so goalie time-sharing
and missed games are already in it), pulled toward the average of his draft round while the
sample is small. Every simulated season also draws a form/injury factor per player, so a hot
start isn't treated as a sure thing. Players owned by several teams are drawn once per season,
which keeps shared picks from inflating anyone. Current rosters only: trades aren't predicted.

Called by insights.py; run alone to print the odds without writing anything.
"""
import math
import random
from statistics import median

from pool_lib import get_json, load, score

SEASON_GAMES = 82
PRIOR_GAMES = 10   # weight of the draft-round average, in games, while a player's sample is small
FORM_SHAPE = 5     # gamma shape of the per-season form factor (mean 1, ~45% spread)
SIMS = 5000


def team_games():
    """{team abbrev: regular-season games played} from the NHL standings."""
    data = get_json("https://api-web.nhle.com/v1/standings/now") or {}
    return {t["teamAbbrev"]["default"]: t["gamesPlayed"] for t in data.get("standings", [])}


def poisson(rng, lam):
    if lam <= 0:
        return 0
    if lam > 30:  # normal approximation, plenty for season totals
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit, k, p = math.exp(-lam), 0, rng.random()
    while p > limit:
        k += 1
        p *= rng.random()
    return k


def simulate(standings, rates, seed, sims=SIMS):
    """standings: [(participant id, points now, [player ids])]; rates: {player id: points left (mean)}.
    Returns {participant id: {"win": %, "podium": %, "projected": median final points}}."""
    rng = random.Random(seed)
    wins = {pid: 0.0 for pid, _, _ in standings}
    podium = {pid: 0 for pid, _, _ in standings}
    finals = {pid: [] for pid, _, _ in standings}
    for _ in range(sims):
        drawn = {p: poisson(rng, lam * rng.gammavariate(FORM_SHAPE, 1 / FORM_SHAPE)) for p, lam in rates.items()}
        totals = {pid: now + sum(drawn.get(p, 0) for p in roster) for pid, now, roster in standings}
        best = max(totals.values())
        leaders = [pid for pid, v in totals.items() if v == best]
        for pid in leaders:
            wins[pid] += 1 / len(leaders)
        ranked = sorted(totals.values(), reverse=True)
        for pid, v in totals.items():
            finals[pid].append(v)
            if v >= ranked[min(2, len(ranked) - 1)]:
                podium[pid] += 1
    return {pid: {"win": round(100 * wins[pid] / sims, 1), "podium": round(100 * podium[pid] / sims, 1),
                  "projected": round(median(finals[pid]))} for pid in wins}


def build(day, previous=None):
    """The odds block for insights.json; `previous` is the block from the last run, used to show the move."""
    config, groups, board = load("config.json"), load("groups.json"), load("leaderboard.json")
    season = load("season_master.json")["players"]
    scoring, played = config["scoring"], team_games()

    def pace(pid, pos):  # points per game of the player's team so far, and that team's games played
        s = season.get(str(pid))
        gp = played.get(s["team"], 0) if s else 0
        return (score(s, pos, scoring), gp) if s else (0, 0)

    prior = {}
    for g in groups:
        paces = [pts / gp for pts, gp in (pace(p["id"], g["pos"]) for p in g["players"]) if gp]
        prior[g["group"]] = sum(paces) / len(paces) if paces else 0

    rates, standings = {}, []
    for s in board["standings"]:
        for p in s["rosterStats"]:
            if p["id"] in rates:
                continue
            pts, gp = pace(p["id"], p["pos"])
            per_game = (pts + PRIOR_GAMES * prior.get(p.get("group"), 0)) / (gp + PRIOR_GAMES)
            rates[p["id"]] = per_game * max(0, SEASON_GAMES - gp)
        standings.append((s["participantId"], s["totalPoints"], [p["id"] for p in s["rosterStats"]]))

    odds = simulate(standings, rates, seed=day)
    # Keep the comparison point on a re-run of the same morning
    if previous and previous.get("asOf") != day:
        before = {pid: o["win"] for pid, o in previous.get("teams", {}).items()}
    else:
        before = (previous or {}).get("before", {})
    return {"asOf": day, "sims": SIMS, "teams": odds, "before": before}


if __name__ == "__main__":
    from history import last_completed_day
    out = build(last_completed_day())
    names = {s["participantId"]: s["teamName"] for s in load("leaderboard.json")["standings"]}
    for pid, o in sorted(out["teams"].items(), key=lambda x: -x[1]["win"]):
        print(f"{names[pid][:28]:28} win {o['win']:5.1f}%  top 3 {o['podium']:5.1f}%  ~{o['projected']} pts")
