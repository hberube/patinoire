#!/usr/bin/env python3
"""L'horoscope du pool: a playful daily horoscope for every participant, written by Claude (Opus) at
noon by the PC's night job (scripts/local/pool_job.sh night), before the first puck drop.

Built from today's facts only: the NHL schedule, each team's players tonight, the standings
neighbours, hot and cold players, injuries and season bingo lines. The last 3 days are kept in
data/horoscope.json and given back to Claude so nothing repeats. Pour toi (js/me/me.js) shows each
participant their own. Off switch: config.features.horoscope (also skips this script).

  python3 scripts/horoscope.py            write data/horoscope.json
  python3 scripts/horoscope.py --dry-run  print the result, write nothing
"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pool_lib import get_json, load, now_iso, save

CLAUDE = os.environ.get("CLAUDE_BIN", str(Path.home() / ".local/bin/claude"))
KEEP_DAYS = 3

PROMPT = """Tu es l'astrologue officiel du « Pool à Hugo », un pool de hockey LNH entre amis et famille au Québec.
Écris l'horoscope d'AUJOURD'HUI pour chaque participant, à partir des FAITS ci-dessous (la soirée de hockey qui s'en vient).

Le ton : parodie d'horoscope de journal, mystique et pince-sans-rire, avec du vocabulaire de hockey
(« Mercure entre dans la zone neutre », « ta lune est en punition mineure », « Jupiter fait un double échec à Saturne »).
Taquin, jamais méchant. On ne rit jamais d'une blessure elle-même.

Règles :
- 2 ou 3 phrases par participant, max 280 caractères par langue. Tutoie le participant.
- Chaque horoscope s'appuie sur AU MOINS UN fait concret de CE participant (un joueur qui joue ce soir, l'écart avec
  son voisin au classement, un joueur en feu ou en panne sèche, un blessé, ses lignes de bingo). N'invente aucun fait.
- Termine par un conseil absurde mais inoffensif (« porte des bas dépareillés », « évite les Zamboni après 19 h »).
- "lucky" : le nom exact d'UN joueur de sa liste tonight (son joueur chanceux du soir), ou "" si sa liste est vide.
- "pucks" : 1 à 5, la promesse de la soirée (5 = soirée légendaire). Varie-les, pas tous à 3 ou 4.
- Chaque horoscope doit être différent des autres ET de ceux de l'HISTORIQUE (pas les mêmes images, planètes ou blagues).
- Un même joueur LNH ne peut être nommé que dans UN seul horoscope du jour (plusieurs participants ont les mêmes joueurs :
  choisis pour chacun un fait qui lui est propre).
- Français québécois naturel, puis une version anglaise drôle aussi (adaptée, pas mot à mot).
- Au plus un émoji par horoscope.

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code, une entrée par participantId des faits :
{"<participantId>": {"fr": "...", "en": "...", "lucky": "...", "pucks": 4}, ...}

"""


def today():
    return datetime.now(ZoneInfo("America/Toronto")).date().isoformat()


def facts(day):
    board = load("leaderboard.json")["standings"]
    hist = load("history.json", {"dates": [], "series": {}})
    ins = load("insights.json", {}) or {}
    form = ins.get("form") or {}
    hurt = {p["id"]: p for p in (load("injuries.json", {}) or {}).get("players", [])}
    games = [g for g in (get_json(f"https://api-web.nhle.com/v1/score/{day}") or {}).get("games", [])]
    opp = {}
    for g in games:
        a, h = g["awayTeam"]["abbrev"], g["homeTeam"]["abbrev"]
        opp[a], opp[h] = f"@ {h}", f"vs {a}"
    lines = {}
    try:  # season bingo lines (needs Node; optional)
        from showfacts import bingo_facts
        prev = hist["dates"][-1] if hist["dates"] else day
        lines = bingo_facts(prev).get("linesById", {})
    except Exception as e:  # noqa: BLE001
        print(f"horoscope: no bingo lines ({e})", file=sys.stderr)
    last = {}
    if len(hist["dates"]) > 1:
        for pid, vals in hist["series"].items():
            if len(vals) > 1 and None not in (vals[-1], vals[-2]):
                last[pid] = vals[-1] - vals[-2]

    out = []
    for i, s in enumerate(board):
        roster = s["rosterStats"]
        tonight = sorted((p for p in roster if p["team"] in opp), key=lambda p: -p["stats"]["points"])
        above, below = (board[i - 1] if i else None), (board[i + 1] if i + 1 < len(board) else None)
        out.append({
            "participantId": s["participantId"], "who": s["participantName"].split(" ")[0], "team": s["teamName"],
            "rank": s["rank"], "points": s["totalPoints"], "lastNight": last.get(s["participantId"]),
            "above": above and {"team": above["teamName"], "gap": above["totalPoints"] - s["totalPoints"]},
            "below": below and {"team": below["teamName"], "gap": s["totalPoints"] - below["totalPoints"]},
            "tonightCount": len(tonight),
            "tonight": [f'{p["name"]} ({p["team"]} {opp[p["team"]]})' for p in tonight[:6]],
            "hot": [p["name"] for p in roster if (form.get(str(p["id"])) or {}).get("last5", 0) >= 5][:3],
            "cold": [f'{p["name"]} ({form[str(p["id"])]["dry"]} matchs sans point)' for p in roster
                     if (form.get(str(p["id"])) or {}).get("dry", 0) >= 4][:3],
            "injured": [f'{hurt[p["id"]]["name"]} ({hurt[p["id"]]["status"]})' for p in roster if p["id"] in hurt][:3],
            "bingoLinesSeason": lines.get(s["participantId"], 0),
        })
    return {"day": day, "gamesTonight": len(games), "participants": out}


def valid(reply, f):
    lucky_ok = {p["participantId"]: {t.split(" (")[0] for t in p["tonight"]} for p in f["participants"]}
    for pid, names in lucky_ok.items():
        x = reply.get(pid)
        if not isinstance(x, dict) or not all(isinstance(x.get(k), str) and 30 <= len(x[k]) <= 400 for k in ("fr", "en")):
            return f"bad text for {pid}"
        if not isinstance(x.get("pucks"), int) or not 1 <= x["pucks"] <= 5:
            return f"bad pucks for {pid}"
        if x.get("lucky") and x["lucky"] not in names:
            x["lucky"] = ""  # a name not in tonight's list: drop it rather than show a wrong player
    return None


def write(f, past):
    prompt = PROMPT + "FAITS :\n" + json.dumps(f, ensure_ascii=False, indent=1) \
        + "\n\nHISTORIQUE (ne pas répéter) :\n" + json.dumps(past, ensure_ascii=False)
    with tempfile.TemporaryDirectory() as tmp:  # empty cwd: no project instructions or memory
        run = subprocess.run(
            [CLAUDE, "-p", "--model", "opus", "--output-format", "json", "--tools", "",
             "--strict-mcp-config", "--no-session-persistence"],
            input=prompt, capture_output=True, text=True, timeout=420, cwd=tmp)
    if run.returncode != 0:
        raise RuntimeError(f"claude exited {run.returncode}: {(run.stderr or run.stdout)[-400:]}")
    reply = json.loads(run.stdout).get("result", "").strip()
    reply = json.loads(reply[reply.find("{"):reply.rfind("}") + 1])  # tolerate stray text or a code fence
    problem = valid(reply, f)
    if problem:
        raise ValueError(f"unexpected horoscope: {problem}")
    return {pid: reply[pid] for pid in (p["participantId"] for p in f["participants"])}


def main(args):
    if (load("config.json", {}).get("features") or {}).get("horoscope") is False and "--dry-run" not in args:
        print("horoscope: switched off")
        return 0
    day = today()
    old = load("horoscope.json", {}) or {}
    if old.get("day") == day and "--force" not in args and "--dry-run" not in args:
        print(f"horoscope: {day} already written")
        return 0
    past = [p for p in old.get("past", []) if p["day"] != day][-KEEP_DAYS:]
    f = facts(day)
    signs = write(f, past)
    if "--dry-run" in args:
        print(json.dumps(signs, ensure_ascii=False, indent=1))
        return 0
    past = (past + [{"day": day, "fr": {pid: x["fr"] for pid, x in signs.items()}}])[-KEEP_DAYS:]
    save("horoscope.json", {"day": day, "generatedAt": now_iso(), "signs": signs, "past": past})
    print(f"horoscope: {day} written for {len(signs)} participants")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
