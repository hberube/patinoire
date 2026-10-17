#!/usr/bin/env python3
"""Morning extras for the Gazette tab: data/insights.json

- highlights: last night's goals by pool players, with NHL.com clip links (FR/EN)
- form:       each rostered player's last-5-games points and current pointless streak
- awards:     Golden Pick, Ice Anchor, Snub ("Busts & Steals")
- milestones: rostered players close to a round number this season
- odds:       each team's chances of winning the pool and finishing top 3 (odds.py)

Run after update_pool.py by the daily workflow. Pool-level milestones and the weekly
duels are computed in the browser from leaderboard.json and history.json.
"""
from collections import Counter

import odds
from history import last_completed_day
from pool_lib import fetch_game_logs, game_line, get_json, load, now_iso, save, score

# (stat, step between milestones, how close counts as "near")
SKATER_MILESTONES = (("goals", 5, 1), ("points", 10, 2))
GOALIE_MILESTONES = (("wins", 5, 1),)


def build():
    config, rosters, groups = load("config.json"), load("rosters.json"), load("groups.json")
    season_players = load("season_master.json")["players"]
    scoring = config["scoring"]
    owners = Counter(p["id"] for r in rosters for p in r["players"])
    rostered = {p["id"]: p for r in rosters for p in r["players"]}
    owner_names = {}
    for r in rosters:
        for p in r["players"]:
            owner_names.setdefault(p["id"], []).append(r["participantId"])

    def season_pts(pid, pos):
        s = season_players.get(str(pid))
        return score(s, pos, scoring) if s else 0

    def card(pid, pos, **extra):
        s = season_players.get(str(pid), {})
        p = rostered.get(pid, {})
        return {"id": pid, "name": s.get("name") or p.get("name"), "team": s.get("team") or p.get("team"),
                "pos": pos, "points": season_pts(pid, pos), "owners": owners.get(pid, 0), **extra}

    # --- Recent form from game logs ---
    logs = fetch_game_logs(rostered, config["season"])
    form = {}
    for pid, games in logs.items():
        pos = rostered[pid]["pos"]
        last5 = sum(score(game_line(g), pos, scoring) for g in games[-5:])
        streak = 0
        for g in reversed(games):
            if g.get("goals", 0) or g.get("assists", 0):
                break
            streak += 1
        form[str(pid)] = {"last5": last5, "games": len(games), "dry": streak if pos != "G" else 0}

    # --- Busts & Steals ---
    picked = [(pid, p["pos"]) for pid, p in rostered.items()]
    fewest = min(owners.values())
    rare = [x for x in picked if owners[x[0]] <= max(2, fewest)]
    golden = max(rare, key=lambda x: (season_pts(*x), -owners[x[0]]), default=None)

    anchors = [(pid, f["dry"]) for pid, f in form.items() if f["dry"] >= 4]
    anchor = max(anchors, key=lambda a: (a[1], owners[int(a[0])]), default=None)

    unpicked = [(p["id"], g["pos"], g["group"]) for g in groups for p in g["players"] if p["id"] not in owners]
    snub = max(unpicked, key=lambda x: season_pts(x[0], x[1]), default=None)

    awards = {
        "goldenPick": card(*golden) if golden else None,
        "iceAnchor": card(int(anchor[0]), rostered[int(anchor[0])]["pos"], dry=anchor[1]) if anchor else None,
        "snub": card(snub[0], snub[1], group=snub[2]) if snub else None,
    }

    # --- Player milestones (season totals) ---
    milestones = []
    for pid, p in rostered.items():
        s = season_players.get(str(pid))
        if not s:
            continue
        totals = {"goals": s["goals"], "points": s["goals"] + s["assists"], "wins": s["wins"]}
        for stat, step, near in GOALIE_MILESTONES if p["pos"] == "G" else SKATER_MILESTONES:
            value = totals[stat]
            target = (value // step + 1) * step
            if target - value <= near:
                milestones.append(card(pid, p["pos"], stat=stat, value=value, target=target))
    milestones.sort(key=lambda m: (m["target"] - m["value"], -m["owners"]))

    # --- Last night's pool goals with highlight clips ---
    day = last_completed_day()
    scores = get_json(f"https://api-web.nhle.com/v1/score/{day}") or {}
    highlights = []
    for g in scores.get("games", []):
        for goal in g.get("goals", []):
            if goal.get("periodDescriptor", {}).get("periodType") == "SO":
                continue
            pool_assists = [a["name"]["default"] for a in goal.get("assists", []) if a["playerId"] in rostered]
            if goal["playerId"] not in rostered and not pool_assists:
                continue
            scorer = goal["playerId"]
            opp = g["homeTeam"]["abbrev"] if goal.get("teamAbbrev") == g["awayTeam"]["abbrev"] else g["awayTeam"]["abbrev"]
            highlights.append({
                "playerId": scorer,
                "name": f"{goal['firstName']['default']} {goal['lastName']['default']}",
                "team": goal.get("teamAbbrev"), "opp": opp,
                "period": goal.get("periodDescriptor", {}).get("number"), "time": goal.get("timeInPeriod"),
                "strength": goal.get("strength"),
                "assists": [a["name"]["default"] for a in goal.get("assists", [])],
                "poolAssists": pool_assists,
                "scorerOwned": scorer in rostered,
                "owners": owners.get(scorer, 0),
                "ownerIds": owner_names.get(scorer, []),
                "clipEn": goal.get("highlightClipSharingUrl"), "clipFr": goal.get("highlightClipSharingUrlFr"),
                "thumb": goal.get("mugshot") or goal.get("headshot"),
            })
    highlights.sort(key=lambda h: (not h["scorerOwned"], -h["owners"]))

    try:  # never lose the rest of the Gazette over the odds
        win_odds = odds.build(day, (load("insights.json") or {}).get("odds"))
    except Exception as e:  # noqa: BLE001
        print(f"warning: odds unavailable ({e})")
        win_odds = None

    save("insights.json", {"lastUpdated": now_iso(), "gameDay": day, "highlights": highlights,
                           "form": form, "awards": awards, "milestones": milestones[:12], "odds": win_odds})
    print(f"insights.json: {len(highlights)} pool goals, {len(milestones)} milestones, "
          f"awards: {', '.join(k for k, v in awards.items() if v)}{', odds' if win_odds else ''}")


if __name__ == "__main__":
    build()
