#!/usr/bin/env python3
"""Morning recap for the front page ("La une"): data/recap.json

Python gathers last night's facts (standings moves, pool goals, milestones, final scores);
Claude only turns them into a short, playful bulletin in French and English.
A second Claude call makes the meme card (scripts/meme.py → data/recap-fr.png and data/recap-en.png):
its topic rotates between an NHL player, a participant, the bingo and an injury, in three formats
(classic, versus, breaking news), and it sees the last memes (data/meme_history.json) so it never
repeats a subject or a joke. Set "recapMeme": false in data/config.json to turn the image off.
Runs on Hugo's PC (scripts/local/pool_job.sh morning) through the `claude` CLI, so the
GitHub workflows never need a key. Any failure leaves the previous recap in place, and a
failed image only drops the image.

  python scripts/recap.py            write the recap for last night (skips if already done)
  python scripts/recap.py --force    rewrite it anyway
  python scripts/recap.py --meme     redo only today's meme (keeps the recap text)
  python scripts/recap.py --text     redo only today's text (keeps the meme)
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
from showfacts import bingo_facts, injury_facts, site_order

CLAUDE = os.environ.get("CLAUDE_BIN", str(Path.home() / ".local/bin/claude"))

PROMPT = """Tu es le chroniqueur du « Pool à Hugo », un pool de hockey LNH entre amis et famille au Québec.
Écris la une de ce matin à partir des FAITS ci-dessous sur les matchs d'hier soir.

Règles :
- Utilise UNIQUEMENT les faits fournis. N'invente aucune statistique, aucun score, aucun nom.
- Ton : chroniqueur sportif enjoué. Taquineries légères des participants (prénom ou nom d'équipe), jeux de mots bienvenus, jamais méchant.
- Mélange les faits saillants des joueurs LNH (buts de joueurs du pool, jalons) et ceux des participants (gros gains de la soirée, remontées, glissades, la course en tête).
- Une puce sur le bingo d'hier soir (section « bingo » : le gagnant et ses lignes, ou un chou blanc mémorable).
- Une puce sur l'infirmerie s'il y a du nouveau (section « injuries » : nouveaux blessés, état qui change ou retour
  au jeu), avec l'équipe LNH du joueur et qui l'a dans le pool. Pas de nouvelle à l'infirmerie : pas de puce.
- Au classement, les égalités de points sont départagées par les lignes de bingo de la saison (bingoLinesSeason).
- Titre accrocheur (max 70 caractères) + 4 à 6 puces courtes. Max 140 mots par langue.
- Français québécois naturel d'abord, puis une version anglaise fidèle (même contenu, pas une traduction mot à mot).
- Pas d'émojis dans le titre; au plus un émoji par puce.{meme_rules}

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code :
{{"fr": {{"title": "...", "bullets": ["...", "..."]}}, "en": {{"title": "...", "bullets": ["...", "..."]}}{meme_shape}}}

FAITS :
"""


MEME_PROMPT = """Tu fais le mème du matin pour la page d'accueil du « Pool à Hugo », un pool de hockey LNH
entre amis et famille au Québec. Le but : faire rire la famille. Un seul mème, à partir des FAITS d'hier soir.

LE SUJET tourne entre 4 catégories :
- "player" : un joueur LNH (un but marquant, un choix rare qui paie, un jalon, une disette);
- "participant" : un participant (grosse soirée, glissade, lanterne rouge, égalité, remontée);
- "bingo" : les cartes de bingo d'hier (le gagnant, celui qui fait chou blanc, le presque-bingo);
- "injury" : une blessure malchanceuse ou ironique pour ceux qui ont le joueur (section injuries).
Choisis la catégorie la plus drôle AUJOURD'HUI, mais JAMAIS la même que le dernier mème de l'HISTORIQUE.

LE FORMAT, différent du dernier mème :
- "classic" : une image, texte en haut (la mise en place, max 45 car.) et en bas (la chute, max 70 car.);
- "versus" : deux panneaux, « NON » en haut (ce qu'on rejette) et « OUI » en bas (ce qu'on adore), une
  image chacun (max 70 car. chacun); parfait pour comparer deux choix, deux participants, deux joueurs;
- "breaking" : écran de nouvelles télé « BULLETIN SPÉCIAL » : un titre (max 50 car.) et un bandeau
  défilant (max 60 car.) avec un détail drôle.

L'IMAGE (subject, et subject2 pour versus) : {"kind": "player", "id": <id d'un joueur des faits>} ou
{"kind": "team", "id": <participantId de la liste participants avec hasPicture: true>}.
Pour bingo et participant, l'image est en général l'équipe du participant.

RÈGLES
- Faits vrais seulement; l'exagération comique est permise si c'est clairement une blague. Jamais méchant,
  pas de moquerie sur une blessure elle-même (on rit de la malchance du participant, pas du joueur).
- Ne réutilise PAS un sujet (joueur ou participant) des 3 derniers mèmes, ni une structure de blague
  déjà vue dans l'HISTORIQUE. Interdit : « X marque. N participants l'ont. Les autres : ... » (déjà usé).
- Pense référence culturelle, jeu de mots, ironie, contraste, fausse solennité. Court et punché.
- Texte en français québécois, puis une version anglaise drôle aussi (pas une traduction mot à mot).

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code :
{"category": "player|participant|bingo|injury", "format": "classic|versus|breaking",
 "subject": {"kind": "player|team", "id": ...}, "subject2": {"kind": "...", "id": ...},
 "fr": {...}, "en": {...}}
où fr et en contiennent selon le format : classic {"top", "bottom"}; versus {"no", "yes"};
breaking {"headline", "ticker"}. Omets subject2 sauf pour versus.

"""
MEME_FIELDS = {"classic": {"top": 60, "bottom": 90}, "versus": {"no": 90, "yes": 90}, "breaking": {"headline": 70, "ticker": 90}}
MEME_HISTORY = 10


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
                and isinstance(part.get("bullets"), list) and 2 <= len(part["bullets"]) <= 7
                and all(isinstance(b, str) and 0 < len(b) <= 300 for b in part["bullets"])):
            return False
    return True


def write(f, meme):
    prompt = PROMPT.format(meme_rules="", meme_shape="")  # the meme has its own call (write_meme)
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


def meme_facts(f):
    """The recap's facts plus what the meme may also joke about: the bingo, the injuries, the participants."""
    out = dict(f)
    try:
        bingo = bingo_facts(f["night"])
        out["standings"] = site_order(f["standings"], bingo.pop("linesById", {}))
        out["bingo"] = bingo
    except Exception as e:  # noqa: BLE001
        print(f"warning: meme without bingo facts ({e})")
    shows = [h for h in (load("radio_history.json", {}) or {}).get("shows", []) if h["gameDay"] < f["night"]]
    before = shows[-1].get("injured") if shows else None
    out["injuries"], _ = injury_facts(before if isinstance(before, dict) else None)
    logos = load("logos.json", {}) or {}
    out["participants"] = [{"id": s["participantId"], "who": f'{first_name(s["participantName"])} ({s["teamName"]})',
                            "hasPicture": bool(logos.get(s["participantId"]))} for s in load("leaderboard.json")["standings"]]
    return out


def text_facts(f):
    """The recap text's facts: the night's facts plus the bingo, the injury news and the site's order."""
    out = meme_facts(f)
    out.pop("participants", None)
    out["notes"] += (" bingo = last night's bingo cards (tonight) and the season race for the year-end prize. "
                     "injuries: new = hurt since yesterday; statusChanged = worse or better (was = old status); "
                     "backInLineup = healthy again. standings: ties on points split by bingoLinesSeason, then goals.")
    return out


def meme_subjects(f):
    """{("player", id): NHL team} and {("team", participantId): None} that the meme may picture."""
    found = {}
    for g in f.get("poolGoals", []):
        found[("player", g["id"])] = g["scorer"].split("(")[1].split(" ")[0]
    for p in f.get("milestonesNear", []) + list(f.get("awards", {}).values()):
        if p:
            found.setdefault(("player", p["id"]), p["team"])
    for x in (f.get("injuries") or {}).get("new", []) + (f.get("injuries") or {}).get("statusChanged", []):
        found.setdefault(("player", x["id"]), x["nhlTeam"])
    for p in f.get("participants", []):
        if p["hasPicture"]:
            found[("team", p["id"])] = None
    return found


def valid_meme(m, subjects):
    if not isinstance(m, dict) or m.get("format") not in MEME_FIELDS:
        return False
    key = lambda s: (s.get("kind"), s.get("id")) if isinstance(s, dict) else None
    if key(m.get("subject")) not in subjects or (m["format"] == "versus" and key(m.get("subject2")) not in subjects):
        return False
    return all(isinstance(m.get(lang), dict) and all(isinstance(m[lang].get(k), str) and 0 < len(m[lang][k]) <= n
               for k, n in MEME_FIELDS[m["format"]].items()) for lang in ("fr", "en"))


def write_meme(f, history):
    prompt = MEME_PROMPT + "HISTORIQUE (les derniers mèmes, le plus récent en dernier) :\n" + (
        json.dumps(history[-MEME_HISTORY:], ensure_ascii=False) if history else "(aucun)") + "\n\nFAITS :\n"
    with tempfile.TemporaryDirectory() as tmp:  # empty cwd: no project instructions or memory
        run = subprocess.run(
            [CLAUDE, "-p", "--model", "opus", "--output-format", "json", "--tools", "",
             "--strict-mcp-config", "--no-session-persistence"],
            input=prompt + json.dumps(f, ensure_ascii=False, indent=1),
            capture_output=True, text=True, timeout=400, cwd=tmp)
    if run.returncode != 0:
        raise RuntimeError(f"claude exited {run.returncode}: {(run.stderr or run.stdout)[-400:]}")
    reply = json.loads(run.stdout).get("result", "").strip()
    return json.loads(reply[reply.find("{"):reply.rfind("}") + 1])


def draw_meme(f, m):
    """Render both languages' cards; returns the recap's "image" entry, or None."""
    subjects = meme_subjects(f)
    if not valid_meme(m, subjects):
        print(f"warning: no meme image, unexpected meme: {json.dumps(m, ensure_ascii=False)[:300]}")
        return None
    try:
        import meme  # needs Pillow (uv run --with pillow on the PC)
        sub = m["subject"]
        team = subjects[(sub["kind"], sub["id"])] or "XXX"
        image = {}
        for lang in ("fr", "en"):
            t, out = m[lang], DATA_DIR / f"recap-{lang}.png"
            if m["format"] == "classic":
                meme.render_classic(sub, team, t["top"], t["bottom"], out)
                alt = f'{t["top"]} / {t["bottom"]}'
            elif m["format"] == "versus":
                meme.render_versus(sub, t["no"], m["subject2"], t["yes"], out, ("NON", "OUI") if lang == "fr" else ("NOPE", "YES"))
                alt = f'{t["no"]} / {t["yes"]}'
            else:
                meme.render_breaking(sub, team, "Bulletin spécial" if lang == "fr" else "Breaking news", t["headline"], t["ticker"], out)
                alt = f'{t["headline"]} — {t["ticker"]}'
            image[lang] = {"src": f"data/recap-{lang}.png", "alt": alt}
        return image
    except Exception as e:
        print(f"warning: no meme image: {e}")
        return None


def make_meme(f):
    """A new meme for f's night, remembered in data/meme_history.json. Returns the image entry or None."""
    history = (load("meme_history.json", {}) or {}).get("memes", [])
    earlier = [h for h in history if h["gameDay"] < f["night"]]
    mf = meme_facts(f)
    try:
        m = write_meme(mf, earlier)
    except Exception as e:  # noqa: BLE001 - the recap stands without its image
        print(f"warning: no meme ({e})")
        return None
    image = draw_meme(mf, m)
    if image:
        entry = {"gameDay": f["night"], "category": m.get("category"), "format": m["format"],
                 "subject": m["subject"], **({"subject2": m["subject2"]} if m["format"] == "versus" else {}), "fr": m["fr"]}
        memes = [h for h in history if h["gameDay"] != f["night"]] + [entry]
        save("meme_history.json", {"memes": sorted(memes, key=lambda h: h["gameDay"])[-MEME_HISTORY:]})
        print(f"meme: {m.get('category')} / {m['format']}")
    return image


def main(args):
    f = facts()
    if "--dry-run" in args:
        print(json.dumps(f, ensure_ascii=False, indent=1))
        return
    if not f["games"]:
        print(f"recap: no games on {f['night']}, nothing to write")
        return
    old = load("recap.json", {}) or {}
    if "--text" in args:  # redo only the text: keep today's meme
        if old.get("gameDay") != f["night"]:
            print(f"recap: no recap for {f['night']} yet; run without --text")
            return
        try:
            text = write(text_facts(f), False)
        except Exception as e:
            print(f"warning: recap not written: {e}")
            return
        save("recap.json", {**old, "generatedAt": now_iso(), "fr": text["fr"], "en": text["en"]})
        print(f"recap.json: {text['fr']['title']}")
        return
    if "--meme" in args:  # redo only the meme: keep the recap text as it is
        if old.get("gameDay") != f["night"]:
            print(f"recap: no recap for {f['night']} yet; run without --meme")
            return
        image = make_meme(f)
        if image:
            save("recap.json", {**old, "generatedAt": now_iso(), "image": image})
        return
    if old.get("gameDay") == f["night"] and "--force" not in args:
        print(f"recap: already written for {f['night']}")
        return
    want_meme = (load("config.json", {}) or {}).get("recapMeme", True)
    try:
        text = write(text_facts(f), False)
    except Exception as e:  # never block the morning job; the old recap simply ages out
        print(f"warning: recap not written: {e}")
        return
    recap = {"gameDay": f["night"], "generatedAt": now_iso(), "fr": text["fr"], "en": text["en"]}
    image = make_meme(f) if want_meme else None
    if image:
        recap["image"] = image
    save("recap.json", recap)
    print(f"recap.json: {text['fr']['title']}")


if __name__ == "__main__":
    main(sys.argv[1:])
