#!/usr/bin/env python3
"""Daily rebuild: pull season stats from the NHL API and recompute the pool standings.

A player's pool points only count while he is on a roster: current players score
(current stats - baseline at acquisition), dropped players keep their banked line.
"""
import history
from pool_lib import (STAT_KEYS, diff_stats, fetch_season_stats, load, now_iso,
                      pool_line, raw_stats, save, weights)


def rebuild_leaderboard(season_players=None):
    config = load("config.json")
    rosters = load("rosters.json")
    scoring = config["scoring"]
    if season_players is None:
        season_players = fetch_season_stats(config["season"])
    stamp = now_iso()

    # Keep every sheet player (and anyone rostered) in the master even before his first game
    sheet_players = [{**p, "pos": g["pos"]} for g in load("groups.json", []) for p in g["players"]]
    for p in sheet_players + [p for team in rosters for p in team["players"]]:
        season_players.setdefault(str(p["id"]), {
            "name": p["name"], "pos": p["pos"], "team": p["team"], "gp": 0,
            **raw_stats({}, p["id"])})
    save("season_master.json", {"lastUpdated": stamp, "season": config["season"],
                                "players": season_players})
    save("players_index.json", sorted(
        ({"id": int(pid), "name": p["name"], "pos": p["pos"], "team": p["team"],
          "points": pool_line(raw_stats(season_players, pid), p["pos"], scoring)["points"]}
         for pid, p in season_players.items()),
        key=lambda p: (-p["points"], p["name"])))

    previous = load("leaderboard.json", {}) or {}
    prev_rank = {s["participantId"]: s["rank"] for s in previous.get("standings", [])}
    prev_points = {s["participantId"]: s["totalPoints"] for s in previous.get("standings", [])}
    # Only treat the old board as "yesterday" if it was built on an earlier day
    same_day = previous.get("lastUpdated", "")[:10] == stamp[:10]
    if same_day:
        prev_rank = previous.get("previousRanks", prev_rank)
        prev_points = previous.get("previousPoints", prev_points)

    standings = []
    for team in rosters:
        totals = {k: 0 for k in STAT_KEYS}
        total_points = 0
        roster_stats = []
        for p in team["players"]:
            line = pool_line(diff_stats(raw_stats(season_players, p["id"]), p.get("baseline")),
                             p["pos"], scoring)
            gp = season_players.get(str(p["id"]), {}).get("gp", 0)
            roster_stats.append({"id": p["id"], "name": p["name"], "pos": p["pos"], "group": p.get("group"),
                                 "team": season_players.get(str(p["id"]), {}).get("team", p["team"]),
                                 "gp": gp, "stats": line})
        former_stats = []
        for p in team.get("formerPlayers", []):
            line = pool_line(p["banked"], p["pos"], scoring)
            former_stats.append({"id": p["id"], "name": p["name"], "pos": p["pos"], "group": p.get("group"),
                                 "team": p["team"], "droppedOn": p["droppedOn"], "stats": line})
        for entry in roster_stats + former_stats:
            total_points += entry["stats"]["points"]
            counted = weights(entry["pos"], scoring)
            for k in STAT_KEYS:
                if k in counted:  # e.g. a goalie's assist only counts if goalies score on assists
                    totals[k] += entry["stats"][k]

        standings.append({
            "participantId": team["participantId"],
            "participantName": team["participantName"],
            "teamName": team.get("teamName", ""),
            "totalPoints": total_points,
            "totalGoals": totals["goals"],
            "totalAssists": totals["assists"],
            "goalieWins": totals["wins"],
            "shootoutGoals": totals["soGoals"],
            "tradesUsed": team["tradesUsed"],
            "rosterStats": sorted(roster_stats, key=lambda e: e["group"] or 0),
            "formerStats": former_stats,
        })

    # Points, then goals as tiebreaker; equal on both share a rank
    standings.sort(key=lambda s: (-s["totalPoints"], -s["totalGoals"], s["participantName"]))
    for i, s in enumerate(standings):
        tied = i and (s["totalPoints"], s["totalGoals"]) == (standings[i - 1]["totalPoints"], standings[i - 1]["totalGoals"])
        s["rank"] = standings[i - 1]["rank"] if tied else i + 1
        s["previousRank"] = prev_rank.get(s["participantId"])
        s["pointsDelta"] = s["totalPoints"] - prev_points[s["participantId"]] if s["participantId"] in prev_points else None

    save("leaderboard.json", {
        "lastUpdated": stamp,
        "season": config["season"],
        "previousRanks": prev_rank,
        "previousPoints": prev_points,
        "standings": standings,
    })
    history.record(standings)
    print(f"Leaderboard rebuilt: {len(standings)} teams, {len(season_players)} NHL players tracked.")
    return season_players


if __name__ == "__main__":
    rebuild_leaderboard()
