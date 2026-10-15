#!/usr/bin/env python3
"""Morning recap for the front page ("La une"): data/recap.json

Python gathers last night's facts (standings moves, pool goals, milestones, final scores);
Claude only turns them into a short, playful bulletin in French and English.
Claude also picks one highlight for a meme card (scripts/meme.py → data/recap-fr.png and
data/recap-en.png); set "recapMeme": false in data/config.json to turn the image off.
Runs on Hugo's PC (scripts/local/pool_job.sh morning) through the `claude` CLI, so the
GitHub workflows never need a key. Any failure leaves the previous recap in place, and a
failed image only drops the image.

  python scripts/recap.py            write the recap for last night (skips if already done)
  python scripts/recap.py --force    rewrite it anyway
  python scripts/recap.py --dry-run  print the facts sent to Claude, call nothing
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from history import last_completed_day
from pool_lib import DATA_DIR, get_json, load, now_iso, save

CLAUDE = os.environ.get("CLAUDE_BIN", str(Path.home() / ".local/bin/claude"))

PROMPT = """Tu es le chroniqueur du « Pool à Hugo », un pool de hockey LNH entre amis et famille au Québec.
Écris la une de ce matin à partir des FAITS ci-dessous sur les matchs d'hier soir.

Règles :
- Utilise UNIQUEMENT les faits fournis. N'invente aucune statistique, aucun score, aucun nom.
- Ton : chroniqueur sportif enjoué. Taquineries légères des participants (prénom ou nom d'équipe), jeux de mots bienvenus, jamais méchant.
- Mélange les faits saillants des joueurs LNH (buts de joueurs du pool, jalons) et ceux des participants (gros gains de la soirée, remontées, glissades, la course en tête).
- Titre accrocheur (max 70 caractères) + 3 à 5 puces courtes. Max 120 mots par langue.
- Français québécois naturel d'abord, puis une version anglaise fidèle (même contenu, pas une traduction mot à mot).
- Pas d'émojis dans le titre; au plus un émoji par puce.{meme_rules}

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code :
{{"fr": {{"title": "...", "bullets": ["...", "..."]}}, "en": {{"title": "...", "bullets": ["...", "..."]}}{meme_shape}}}

FAITS :
"""


MEME_RULES = """
- Mème : choisis UN fait saillant drôle D'HIER SOIR lié à un joueur des faits (champ "id"). Priorité aux
  buts d'hier (poolGoals), surtout ceux qui font bouger le classement ou un choix rare; milestonesNear ou awards
  seulement si rien d'hier soir ne s'y prête. Texte de mème classique, haut + bas, en majuscules implicites : "top" max 45
  caractères (la mise en place), "bottom" max 70 caractères (la chute). Les faits restent vrais; l'exagération
  comique est permise seulement si elle est évidemment une blague. Peut taquiner les participants concernés."""
MEME_SHAPE = ', "meme": {"playerId": 0, "fr": {"top": "...", "bottom": "..."}, "en": {"top": "...", "bottom": "..."}}'


def first_name(full):
    return (full or "").split(" ")[0]


def facts():
    day = last_completed_day()
    board = load("leaderboard.json")
    hist = load("history.json", {"dates": [], "series": {}})
    ins = load("insights.json", {}) or {}

    scores = get_json(f"https://api-web.nhle.com/v1/score/{day}") or {}
    games = [{"away": g["awayTeam"]["abbrev"], "home": g["homeTeam"]["abbrev"],
              "score": f'{g["awayTeam"].get("score")}-{g["homeTeam"].get("score")}',
              "ending": g.get("gameOutcome", {}).get("lastPeriodType")}
             for g in scores.get("games", []) if g.get("gameState") in ("OFF", "FINAL")]

    # Points gained last night: the last two history snapshots, as on the site (dayDeltas)
    gained = {}
    if day in hist["dates"] and hist["dates"].index(day) > 0:
        i = hist["dates"].index(day)
        for pid, vals in hist["series"].items():
            if i < len(vals) and vals[i] is not None and vals[i - 1] is not None:
                gained[pid] = vals[i] - vals[i - 1]

    names = {s["participantId"]: f'{first_name(s["participantName"])} ({s["teamName"]})' for s in board["standings"]}
    standings = [{"rank": s["rank"], "who": names[s["participantId"]], "points": s["totalPoints"],
                  "lastNight": gained.get(s["participantId"]),
                  "rankChange": (s["previousRank"] - s["rank"]) if s.get("previousRank") else 0}
                 for s in board["standings"]]

    goals = []
    if ins.get("gameDay") == day:
        for h in ins.get("highlights", []):
            goals.append({"id": h["playerId"], "scorer": f'{h["name"]} ({h["team"]} vs {h["opp"]})',
                          "ownedBy": [names.get(o, o) for o in h.get("ownerIds", [])] if h.get("owners", 0) <= 3
                          else f'{h.get("owners", 0)} participants',
                          "poolAssists": h.get("poolAssists", [])})

    def short(p):
        return {k: p[k] for k in ("id", "name", "team", "points", "owners", "stat", "value", "target", "dry") if k in p}

    # Keep the prompt small: the widely-owned goals plus the rare picks (the fun stories)
    goals = goals[:8] + [g for g in goals[8:] if isinstance(g["ownedBy"], list)][:6]
    return {"night": day, "games": games, "standings": standings, "poolGoals": goals,
            "milestonesNear": [short(m) for m in ins.get("milestones", [])][:6],
            "awards": {k: short(v) for k, v in (ins.get("awards") or {}).items()},
            "notes": "rankChange > 0 = climbed. lastNight = pool points gained last night. "
                     "awards: goldenPick = best pick owned by few, iceAnchor = cold rostered player "
                     "(dry = games without a point), snub = star nobody picked."}


def valid(text):
    if not isinstance(text, dict):
        return False
    for lang in ("fr", "en"):
        part = text.get(lang)
        if not (isinstance(part, dict) and isinstance(part.get("title"), str) and 0 < len(part["title"]) <= 120
                and isinstance(part.get("bullets"), list) and 2 <= len(part["bullets"]) <= 6
                and all(isinstance(b, str) and 0 < len(b) <= 300 for b in part["bullets"])):
            return False
    return True


def meme_players(f):
    """playerId -> team for every player Claude may put on the meme card."""
    found = {}
    for g in f["poolGoals"]:
        found[g["id"]] = g["scorer"].split("(")[1].split(" ")[0]
    for p in f["milestonesNear"] + list(f["awards"].values()):
        found.setdefault(p["id"], p["team"])
    return found


def valid_meme(m, players):
    return (isinstance(m, dict) and m.get("playerId") in players
            and all(isinstance(m.get(lang), dict)
                    and isinstance(m[lang].get("top"), str) and 0 < len(m[lang]["top"]) <= 60
                    and isinstance(m[lang].get("bottom"), str) and 0 < len(m[lang]["bottom"]) <= 90
                    for lang in ("fr", "en")))


def write(f, meme):
    prompt = PROMPT.format(meme_rules=MEME_RULES if meme else "", meme_shape=MEME_SHAPE if meme else "")
    with tempfile.TemporaryDirectory() as tmp:  # empty cwd: no project instructions or memory
        run = subprocess.run(
            [CLAUDE, "-p", "--model", "sonnet", "--output-format", "json", "--tools", "",
             "--strict-mcp-config", "--no-session-persistence"],
            input=prompt + json.dumps(f, ensure_ascii=False, indent=1),
            capture_output=True, text=True, timeout=240, cwd=tmp)
    if run.returncode != 0:
        raise RuntimeError(f"claude exited {run.returncode}: {(run.stderr or run.stdout)[-400:]}")
    reply = json.loads(run.stdout).get("result", "").strip()
    reply = reply[reply.find("{"):reply.rfind("}") + 1]  # tolerate stray text or a code fence
    text = json.loads(reply)
    if not valid(text):
        raise ValueError(f"unexpected recap shape: {reply[:300]}")
    return text


def draw_meme(f, m):
    """Render both languages' cards; returns the recap's "image" entry, or None."""
    players = meme_players(f)
    if not valid_meme(m, players):
        print(f"warning: no meme image, unexpected meme: {json.dumps(m, ensure_ascii=False)[:200]}")
        return None
    try:
        from meme import render  # needs Pillow (uv run --with pillow on the PC)
        image = {}
        for lang in ("fr", "en"):
            path = f"data/recap-{lang}.png"
            render(m["playerId"], players[m["playerId"]], m[lang]["top"], m[lang]["bottom"],
                   DATA_DIR / f"recap-{lang}.png")
            image[lang] = {"src": path, "alt": f'{m[lang]["top"]} / {m[lang]["bottom"]}'}
        return image
    except Exception as e:
        print(f"warning: no meme image: {e}")
        return None


def main(args):
    f = facts()
    if "--dry-run" in args:
        print(json.dumps(f, ensure_ascii=False, indent=1))
        return
    if not f["games"]:
        print(f"recap: no games on {f['night']}, nothing to write")
        return
    old = load("recap.json", {}) or {}
    if old.get("gameDay") == f["night"] and "--force" not in args:
        print(f"recap: already written for {f['night']}")
        return
    want_meme = (load("config.json", {}) or {}).get("recapMeme", True)
    try:
        text = write(f, want_meme)
    except Exception as e:  # never block the morning job; the old recap simply ages out
        print(f"warning: recap not written: {e}")
        return
    recap = {"gameDay": f["night"], "generatedAt": now_iso(), "fr": text["fr"], "en": text["en"]}
    image = draw_meme(f, text.get("meme")) if want_meme else None
    if image:
        recap["image"] = image
    save("recap.json", recap)
    print(f"recap.json: {text['fr']['title']}")


if __name__ == "__main__":
    main(sys.argv[1:])
