#!/usr/bin/env python3
"""« Ton segment de la semaine »: every Sunday, Sylvie and Jean (the radio show's hosts) record about
25 seconds for each participant: their week, their duel, their hot and cold players, their bingo, a
pep talk. Fun, encouraging, a little teasing. One Claude (Opus) call writes all of them; ElevenLabs
voices each one (the same voices and key as scripts/radio.py; the free voices if it fails).

Output: data/segments/<participantId>.mp3 (replaced each week) and data/segments.json (week, lengths,
transcripts). Pour toi (js/me/me.js) plays yours. Runs in the PC morning job on Sundays
(scripts/local/pool_job.sh). Off switch: config.features.segments (also skips this script).

  uv run --with requests --with edge-tts python scripts/segments.py                this week's segments
  ... segments.py --force                          redo them anyway (another day of the week too)
  ... segments.py --only usr_a,usr_b --out DIR     a test: just these, written to DIR, nothing published
  ... segments.py --dry-run                        print the scripts, no audio
"""
import json
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

from history import EASTERN
from pool_lib import DATA_DIR, load, now_iso, save
from radio import voice
from recap import CLAUDE

HOSTS = ("sylvie", "jean")

PROMPT = """Tu écris « Ton segment de la semaine » : un mini-segment radio PERSONNEL d'environ 25 secondes pour chaque
participant du « Pool à Hugo », un pool de hockey LNH entre amis et famille au Québec. Les animateurs sont ceux
de l'émission du matin :
- Sylvie : vive, pince-sans-rire, reine des jeux de mots, tient les statistiques.
- Jean : enthousiaste, dramatique, voit des « moments historiques » partout.

LE BUT : que chaque participant sourie en l'écoutant. Le segment lui parle directement (tutoiement, son prénom).
- Drôle : une taquinerie affectueuse, un jeu de mots sur son équipe ou ses joueurs, une exagération de Jean.
- Encourageant : il finit TOUJOURS sur une note positive, même après une semaine difficile (« la remontée commence
  ce soir », « tes joueurs te doivent une soirée »). Les bonnes semaines, on célèbre en grand.
- Basé sur SES faits : sa semaine (points, rang de la semaine sur le groupe), son duel de la semaine (encore en cours :
  il reste les matchs de ce soir), un joueur en feu ou en panne sèche, ses lignes de bingo, un blessé. Choisis 2 ou 3
  faits, pas tout. N'invente rien.
- Jamais méchant, pas de moquerie sur l'âge ou le physique, compatissant pour les blessés.
- Chaque segment est différent : pas la même ouverture, la même blague ou la même structure d'un participant à l'autre.

À L'ORAL
- 55 à 70 mots par segment (environ 25 secondes), 3 à 5 répliques qui alternent entre Sylvie et Jean.
- Phrases courtes, français québécois naturel, nombres en chiffres, aucun émoji, aucune abréviation.
- Les noms d'équipe bizarres (SK|MADDOXG) : utilise plutôt le prénom.
- Au plus 2 indications de jeu entre crochets en anglais par segment : [laughs], [chuckles], [excited], [sighs], [whispers].
- Ne dis pas « bonjour à tous » : c'est pour UNE personne.

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code, une entrée par participantId des faits :
{"<participantId>": [{"host": "sylvie", "line": "..."}, {"host": "jean", "line": "..."}], ...}

FAITS :
"""


# The site's weekly duels (weekDuels() in js/app.js, makeRng/seededShuffle in js/bingo.js), so the
# segment names the same opponent as Pour toi
def _rng(seed_text):
    seed = 0
    for ch in seed_text:
        seed = (seed * 31 + ord(ch)) & 0xFFFFFFFF

    def imul(a, b):  # Math.imul, kept unsigned: the bits are the same
        return (a * b) & 0xFFFFFFFF

    def rand():
        nonlocal seed
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        x = seed
        x = imul(x ^ (x >> 15), x | 1)
        x ^= (x + imul(x ^ (x >> 7), x | 61)) & 0xFFFFFFFF
        return ((x ^ (x >> 14)) & 0xFFFFFFFF) / 4294967296
    return rand


def seeded_shuffle(items, seed_text):
    rand, a = _rng(seed_text), list(items)
    for i in range(len(a) - 1, 0, -1):
        j = int(rand() * (i + 1))
        a[i], a[j] = a[j], a[i]
    return a


def week_gains(hist, monday):
    sunday = (date.fromisoformat(monday) + timedelta(days=6)).isoformat()
    before = len([d for d in hist["dates"] if d < monday]) - 1
    last = len([d for d in hist["dates"] if d <= sunday]) - 1
    out = {}
    for pid, vals in hist["series"].items():
        end = (vals[last] if last >= 0 and last < len(vals) else 0) or 0
        start = (vals[before] if before >= 0 and before < len(vals) else 0) or 0
        out[pid] = end - start if last >= 0 else 0
    return out


def facts(today):
    board = load("leaderboard.json")["standings"]
    hist = load("history.json", {"dates": [], "series": {}})
    form = (load("insights.json", {}) or {}).get("form") or {}
    hurt = {p["id"]: p for p in (load("injuries.json", {}) or {}).get("players", [])}
    monday = (today - timedelta(days=today.weekday())).isoformat()
    gains = week_gains(hist, monday)
    ids = sorted(s["participantId"] for s in board)
    order = seeded_shuffle(ids, monday)
    rival = {}
    for i in range(0, len(order), 2):
        a, b = order[i], order[i + 1] if i + 1 < len(order) else None
        rival[a], rival[b] = b, a
    avg = round(sum(gains.values()) / max(1, len(ids)))
    by_id = {s["participantId"]: s for s in board}
    week_rank = {pid: 1 + sum(g > gains.get(pid, 0) for g in gains.values()) for pid in ids}
    lines = {}
    try:  # this week's bingo lines: season lines now minus before Monday (needs Node; optional)
        from showfacts import bingo_facts
        nights = [n["day"] for n in (load("bingo.json", {}) or {}).get("nights", [])]
        now_l = bingo_facts(nights[-1]).get("linesById", {}) if nights else {}
        prev = [d for d in nights if d < monday]
        then_l = bingo_facts(prev[-1]).get("linesById", {}) if prev else {}
        lines = {pid: now_l.get(pid, 0) - then_l.get(pid, 0) for pid in ids}
    except Exception as e:  # noqa: BLE001
        print(f"segments: no bingo lines ({e})", file=sys.stderr)

    out = []
    for s in board:
        pid, roster = s["participantId"], s["rosterStats"]
        o = rival.get(pid)
        f = lambda p: form.get(str(p["id"])) or {}  # noqa: E731
        out.append({
            "participantId": pid, "firstName": s["participantName"].split(" ")[0], "team": s["teamName"],
            "rank": s["rank"], "points": s["totalPoints"],
            "week": {"points": gains.get(pid, 0), "rankAmongAll": week_rank.get(pid), "of": len(ids)},
            "duel": {"against": by_id[o]["participantName"].split(" ")[0] + f' ({by_id[o]["teamName"]})' if o else "le fantôme (la moyenne du pool)",
                     "me": gains.get(pid, 0), "them": gains.get(o, avg) if o else avg, "stillToPlay": "les matchs de ce soir (dimanche)" if today.weekday() == 6 else "les matchs de ce soir jusqu'à dimanche"},
            "hot": [f'{p["name"]} ({f(p)["last5"]} pts en 5 matchs)' for p in sorted(roster, key=lambda p: -f(p).get("last5", 0)) if f(p).get("last5", 0) >= 5][:3],
            "cold": [f'{p["name"]} ({f(p)["dry"]} matchs sans point)' for p in roster if f(p).get("dry", 0) >= 4][:2],
            "injured": [f'{hurt[p["id"]]["name"]} ({p["team"]})' for p in roster if p["id"] in hurt][:2],
            "bingoLinesThisWeek": lines.get(pid),
        })
    return monday, out


def valid(reply, ids):
    for pid in ids:
        lines = reply.get(pid)
        if not (isinstance(lines, list) and 2 <= len(lines) <= 7 and all(
                isinstance(x, dict) and x.get("host") in HOSTS and isinstance(x.get("line"), str) and 0 < len(x["line"]) <= 300
                for x in lines)):
            return f"bad segment for {pid}"
        words = sum(len(x["line"].split()) for x in lines)
        if not 35 <= words <= 110:
            return f"segment for {pid} is {words} words"
    return None


def write(people):
    with tempfile.TemporaryDirectory() as tmp:  # empty cwd: no project instructions or memory
        run = subprocess.run(
            [CLAUDE, "-p", "--model", "opus", "--output-format", "json", "--tools", "",
             "--strict-mcp-config", "--no-session-persistence"],
            input=PROMPT + json.dumps(people, ensure_ascii=False, indent=1),
            capture_output=True, text=True, timeout=600, cwd=tmp)
    if run.returncode != 0:
        raise RuntimeError(f"claude exited {run.returncode}: {(run.stderr or run.stdout)[-400:]}")
    reply = json.loads(run.stdout).get("result", "").strip()
    reply = json.loads(reply[reply.find("{"):reply.rfind("}") + 1])
    problem = valid(reply, [p["participantId"] for p in people])
    if problem:
        raise ValueError(f"unexpected segments: {problem}")
    return reply


def arg(args, name):
    return args[args.index(name) + 1] if name in args else None


def main(args):
    test = "--only" in args or "--dry-run" in args
    if (load("config.json", {}).get("features") or {}).get("segments") is False and not test:
        print("segments: switched off")
        return 0
    today = datetime.now(EASTERN).date()
    if today.weekday() != 6 and "--force" not in args and not test:
        print("segments: only on Sundays")
        return 0
    monday, people = facts(today)
    old = load("segments.json", {}) or {}
    if old.get("week") == monday and "--force" not in args and not test:
        print(f"segments: week of {monday} already recorded")
        return 0
    only = arg(args, "--only")
    if only:
        people = [p for p in people if p["participantId"] in only.split(",")]
    scripts = write(people)
    if "--dry-run" in args:
        for p in people:
            print(f"\n== {p['firstName']} ({p['team']})")
            print("\n".join(f"{x['host'].upper()}: {x['line']}" for x in scripts[p["participantId"]]))
        return 0
    out = Path(arg(args, "--out") or DATA_DIR / "segments")
    out.mkdir(parents=True, exist_ok=True)
    done = {}
    for p in people:
        pid = p["participantId"]
        part = out / f"{pid}.mp3.part"
        try:
            engine, bitrate = voice(scripts[pid], part)
        except Exception as e:  # noqa: BLE001  one failed voice skips that participant only
            part.unlink(missing_ok=True)
            print(f"warning: no segment for {pid} ({e})")
            continue
        part.replace(out / f"{pid}.mp3")
        done[pid] = {"duration": round((out / f"{pid}.mp3").stat().st_size * 8 / bitrate), "engine": engine,
                     "lines": scripts[pid]}
    if only:
        (out / "scripts.txt").write_text("\n\n".join(f"== {p['firstName']}\n" + "\n".join(
            f"{x['host'].upper()}: {x['line']}" for x in scripts[p["participantId"]]) for p in people), encoding="utf-8")
        print(f"segments (test): {', '.join(f'{k} {v['duration']}s' for k, v in done.items())} in {out}")
        return 0
    save("segments.json", {"week": monday, "generatedAt": now_iso(), "segments": done})
    print(f"segments: {len(done)}/{len(people)} recorded for the week of {monday} "
          f"({sum(v['duration'] for v in done.values())} s, {', '.join(sorted({v['engine'] for v in done.values()}))})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
