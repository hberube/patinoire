#!/usr/bin/env python3
"""Is the pool site up to date right now? The checklist the overseers run.

Reads what's published (main and live branches on GitHub, and the Pages site itself) and the
NHL schedule, and compares them with what should be true at this hour, Eastern time:

  standings  last night's games are in the standings, history and Gazette once they're all final
  recap      Claude's front-page recap of last night is out by 5:30 AM
  live       on a game day, "Ce soir" shows today from 12:15 PM, refreshes while games are on,
             and shows the final scores once they're over
  site       GitHub Pages serves what's on main (a stuck deploy)

Each problem names the job that fixes it (standings, recap or live; site and nhl have no repair),
for scripts/local/overseer.sh.

  python scripts/healthcheck.py           # readable report; exit code 1 if anything is wrong
  python scripts/healthcheck.py --json    # for the overseer
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import requests

from history import EASTERN, game_day_now, last_completed_day

REPO = "hberube/patinoire"
RAW = f"https://raw.githubusercontent.com/{REPO}"
SITE = "https://hberube.github.io/patinoire"
FINAL = {"OFF", "FINAL"}
LIVE = {"LIVE", "CRIT"}


def fetch(url):
    try:
        res = requests.get(url, params={"t": int(datetime.now().timestamp())}, timeout=30,
                           headers={"Cache-Control": "no-cache"})
        return res.json() if res.ok else None
    except (requests.RequestException, ValueError):
        return None


def when(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")) if iso else None


def schedule(day):
    """[(start, state)] for a game day, from the NHL; None if the NHL can't be reached."""
    data = fetch(f"https://api-web.nhle.com/v1/score/{day}")
    return None if data is None else [(when(g["startTimeUTC"]), g["gameState"]) for g in data.get("games", [])]


def check(now=None):
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(EASTERN)
    problems, notes = [], []

    def problem(fix, key, text):
        problems.append({"fix": fix, "key": key, "text": text})

    main = {name: fetch(f"{RAW}/main/data/{name}") for name in ("leaderboard.json", "history.json", "insights.json", "recap.json", "config.json")}
    if not main["leaderboard.json"]:
        problem("site", "unreachable", "Can't read the pool data on GitHub")
        return problems, notes

    # --- Last night: standings, history, Gazette, recap ---
    day = last_completed_day()
    games = schedule(day)
    if games is None:  # never report "all good" without having seen the schedule
        problem("nhl", "nhl-unreachable", "Can't reach the NHL schedule (api-web.nhle.com) to check the site")
        return problems, notes
    if games and all(state in FINAL for _, state in games):
        last_start = max(start for start, _ in games)
        done_by = last_start + timedelta(hours=3, minutes=30)  # last game over, plus margin
        if now > done_by:
            updated = when(main["leaderboard.json"].get("lastUpdated"))
            if not updated or updated < last_start + timedelta(hours=2, minutes=30):
                problem("standings", f"standings-{day}", f"Standings don't include last night's games ({day})")
            elif local.hour >= 5:
                # The morning run adds the day to the chart and rebuilds the Gazette
                if day not in (main["history.json"] or {}).get("dates", []):
                    problem("standings", f"history-{day}", f"Chart history is missing {day}")
                if ((main["insights.json"] or {}).get("gameDay") or "") < day:
                    problem("standings", f"gazette-{day}", f"Gazette is still on {(main['insights.json'] or {}).get('gameDay')}, not {day}")
        if (local.hour, local.minute) >= (5, 30) and ((main["recap.json"] or {}).get("gameDay") or "") < day:
            problem("recap", f"recap-{day}", f"No front-page recap of {day} yet")
        notes.append(f"last night {day}: {len(games)} games, all final")
    elif games:
        notes.append(f"last night {day}: {sum(s in FINAL for _, s in games)}/{len(games)} games final")

    # --- Tonight: live scores ("Ce soir" and the bingo) ---
    today = game_day_now()
    tonight = (schedule(today) or []) if today != day else games
    live = fetch(f"{RAW}/live/live.json")
    if tonight:
        live_day, live_age = (live or {}).get("gameDay"), now - (when((live or {}).get("updated")) or now - timedelta(days=9))
        on_now = any(state in LIVE for _, state in tonight)
        # Before noon "today" is still last night; the switch to the new day happens from noon
        if not (12, 0) <= (local.hour, local.minute) < (12, 15):
            if live_day != today:
                problem("live", f"live-day-{today}", f"Ce soir still shows {live_day}, not today ({today})")
            elif on_now and live_age > timedelta(minutes=12):
                problem("live", f"live-stale-{today}", f"Live scores haven't refreshed for {int(live_age.total_seconds() // 60)} min during games")
            elif all(state in FINAL for _, state in tonight):
                last_start = max(start for start, _ in tonight)
                shown_final = all(g.get("state") in FINAL for g in (live or {}).get("games", []))
                if not shown_final and now > last_start + timedelta(hours=3, minutes=30):
                    problem("live", f"live-final-{today}", "Ce soir doesn't show tonight's final scores")
        notes.append(f"today {today}: {len(tonight)} games, {sum(s in LIVE for _, s in tonight)} live")

    # --- GitHub Pages serves what's on main (deploys can get stuck) ---
    site = fetch(f"{SITE}/data/leaderboard.json")
    main_stamp = main["leaderboard.json"].get("lastUpdated")
    if site and site.get("lastUpdated") != main_stamp and now - when(main_stamp) > timedelta(minutes=20):
        problem("site", "pages", f"The site still serves standings from {site.get('lastUpdated')} (main has {main_stamp})")
    return problems, notes


def main(args):
    problems, notes = check()
    if "--json" in args:
        print(json.dumps({"ok": not problems, "problems": problems, "notes": notes}, ensure_ascii=False))
    else:
        for n in notes:
            print(f"  {n}")
        print("\n".join(f"✗ [{p['fix']}] {p['text']}" for p in problems) or "✓ Everything is up to date")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
