#!/usr/bin/env python3
"""Apply an approved trade code, then rebuild the leaderboard.

Usage: python scripts/execute_trade.py <trade_code>
The trade code is base64url(JSON) produced by the site's trade builder:
  {"v":1,"tradeId","participantId","pos","outId","inId","ts"}
"""
import base64
import json
import sys
from datetime import datetime, timezone

from pool_lib import (diff_stats, fetch_season_stats, load, lookup_player, now_iso, raw_stats,
                      save)
from update_pool import rebuild_leaderboard


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def decode(code):
    code = code.strip()
    try:
        raw = base64.urlsafe_b64decode(code + "=" * (-len(code) % 4))
        trade = json.loads(raw.decode("utf-8"))
    except Exception:
        fail("Trade code is not valid.")
    for key in ("tradeId", "participantId", "pos", "outId", "inId"):
        if key not in trade:
            fail(f"Trade code is missing '{key}'.")
    return trade


def apply_trade(code):
    trade = decode(code)
    config = load("config.json")
    rosters = load("rosters.json")
    history = load("trades_history.json", [])

    if any(t["tradeId"] == trade["tradeId"] for t in history):
        fail(f"Trade {trade['tradeId']} was already processed.")

    window = datetime.fromisoformat(config["tradeWindowStart"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) < window:
        fail(f"The trade window opens {config['tradeWindowStart']}.")

    team = next((r for r in rosters if r["participantId"] == trade["participantId"]), None)
    if not team:
        fail(f"Participant {trade['participantId']} not found.")

    pos = trade["pos"]
    if pos not in config["maxTrades"]:
        fail(f"Unknown position {pos}.")
    used = team["tradesUsed"].get(pos, 0)
    if used >= config["maxTrades"][pos]:
        fail(f"{team['participantName']} has already used all {pos} trades.")

    out_id, in_id = int(trade["outId"]), int(trade["inId"])
    out_player = next((p for p in team["players"] if p["id"] == out_id), None)
    if not out_player or out_player["pos"] != pos:
        fail(f"Player {out_id} is not a {pos} on {team['participantName']}'s roster.")
    if any(p["id"] == in_id for p in team["players"]):
        fail(f"Player {in_id} is already on {team['participantName']}'s roster.")
    group = next(g for g in load("groups.json") if g["group"] == out_player["group"])
    if not any(p["id"] == in_id for p in group["players"]):
        fail(f"Player {in_id} is not in {out_player['name']}'s group ({group['group']}).")

    season_players = fetch_season_stats(config["season"])
    # Any active NHL player can be traded for, drafted in the pool or not
    incoming = season_players.get(str(in_id)) or lookup_player(in_id)
    if not incoming:
        fail(f"Player {in_id} is not an active NHL player.")
    season_players.setdefault(str(in_id), incoming)
    if (incoming["pos"] == "G") != (pos == "G") or (pos != "G" and incoming["pos"] != pos):
        fail(f"{incoming['name']} is a {incoming['pos']}, not a {pos}.")

    today = now_iso()
    banked = diff_stats(raw_stats(season_players, out_id), out_player.get("baseline"))
    team["players"].remove(out_player)
    team.setdefault("formerPlayers", []).append({
        "id": out_id, "name": out_player["name"], "pos": pos, "team": out_player["team"],
        "group": group["group"], "banked": banked, "droppedOn": today})
    team["players"].append({
        "id": in_id, "name": incoming["name"], "pos": pos, "team": incoming["team"],
        "group": group["group"], "baseline": raw_stats(season_players, in_id)})
    team["players"].sort(key=lambda p: p["group"])
    team["tradesUsed"][pos] = used + 1

    history.append({
        "tradeId": trade["tradeId"],
        "participantId": team["participantId"],
        "participantName": team["participantName"],
        "pos": pos,
        "group": group["group"],
        "submittedAt": trade.get("ts"),
        "approvedAt": today,
        "playerOut": {"id": out_id, "name": out_player["name"], "team": out_player["team"]},
        "playerIn": {"id": in_id, "name": incoming["name"], "team": incoming["team"]},
    })
    save("rosters.json", rosters)
    save("trades_history.json", history)
    print(f"Trade {trade['tradeId']}: {team['participantName']} drops {out_player['name']}, "
          f"adds {incoming['name']} ({pos}).")
    rebuild_leaderboard(season_players)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    apply_trade(sys.argv[1])
