#!/usr/bin/env python3
"""« Les Ondes de la Patinoire »: a 2-3 minute morning radio show about last night.

Claude writes a two-host dialogue (Sylvie and Jean) from the same facts as the front-page recap
(recap.facts()), plus last night's bingo (scripts/bingo_night.mjs: the site's own card code, run
with Node), the injury report since the previous show, and what the last shows already said
(data/radio_history.json), so it never tells the same joke twice. ElevenLabs then voices it as one
conversation (text-to-dialogue, eleven_v3). The API key stays on Hugo's PC in
~/pool_patinoire_elevenlabs.txt (never in the repo); the two voice ids are in data/config.json
("radio": {"voices": {"sylvie": ..., "jean": ...}}). Without a key, or if ElevenLabs fails,
Microsoft's free Québécois voices read it instead (edge-tts package).
Output: data/radio.mp3, data/radio.json (with the transcript) and data/radio_history.json.
Runs on Hugo's PC after the recap (scripts/local/pool_job.sh morning); any failure keeps the
previous show, which the site stops showing once it's old. Off switch: "features": {"radio": false}
in data/config.json.

  uv run --with edge-tts --with requests python scripts/radio.py            last night's show
  uv run --with edge-tts --with requests python scripts/radio.py --force    rewrite it anyway
  python scripts/radio.py --dry-run                         print the facts and dialogue, no audio
"""
import asyncio
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import requests

from pool_lib import DATA_DIR, load, now_iso, save
from recap import CLAUDE, facts
from showfacts import bingo_facts, injury_facts, site_order

HOSTS = ("sylvie", "jean")
KEY_FILE = Path.home() / "pool_patinoire_elevenlabs.txt"
ELEVEN = "https://api.elevenlabs.io/v1"
EDGE_VOICES = {"sylvie": "fr-CA-SylvieNeural", "jean": "fr-CA-JeanNeural"}  # the free fallback
HISTORY_DAYS = 7

PROMPT = """Tu écris le texte de « Les Ondes de la Patinoire », l'émission de radio matinale (2 à 3 minutes)
du « Pool à Hugo », un pool de hockey LNH entre amis et famille au Québec.

LES ANIMATEURS
- Sylvie : vive, pince-sans-rire, reine de la répartie et des jeux de mots; elle tient les statistiques
  et ne rate jamais une occasion de piquer gentiment.
- Jean : enthousiaste, dramatique, chauvin du Canadien à en être aveugle; il voit des « moments historiques »
  partout et se fait remettre à sa place par Sylvie.
Leur complicité fait la moitié du plaisir : relances, interruptions, fausse indignation, rires.

LE BUT : faire rire la famille autour du café, avec des faits vrais.
- Humour : jeux de mots sur les noms d'équipes et de joueurs, contrastes comiques (le meneur qui plane,
  la lanterne rouge qui creuse), exagérations assumées de Jean, taquineries affectueuses des flops de la
  soirée, petites mises en scène (« on a reçu un appel de… », « bulletin spécial »), rappels comiques aux
  émissions précédentes. Jamais méchant, jamais vulgaire, pas de moquerie sur l'âge ou le physique.
- Utilise UNIQUEMENT les faits fournis. N'invente aucune statistique, aucun score, aucun nom.
- RIEN DE RÉCHAUFFÉ : la section DÉJÀ DIT contient les émissions précédentes. Ne reprends AUCUNE blague,
  formule, comparaison ou information déjà dite (par exemple « personne n'a choisi X ») à moins qu'un fait
  ait CHANGÉ. Un rappel volontaire à une ancienne blague est permis s'il l'amène plus loin.

L'ORDRE DE L'ÉMISSION
1. Ouverture punchée façon radio sportive (c'est le MATIN : « bonjour », jamais « bonsoir »).
2. Le drame du classement : gros gains, remontées, glissades, la course en tête, la lanterne rouge.
3. Le bingo d'hier soir (section « bingo ») : le gagnant et ses lignes, la lutte serrée, celui qui est passé
   proche ou qui a fait chou blanc; puis un mot sur la course au bingo de la saison (un prix attend le
   champion à la fin de l'année).
4. Le bulletin de l'infirmerie (section « injuries ») : les NOUVEAUX blessés, ceux dont l'état a changé
   (« statusChanged » : pire ou mieux qu'hier), et les retours au jeu, avec
   l'équipe LNH du joueur et les participants qui l'ont; « stillOut » seulement si ça change quelque chose.
   Compatissant pour le joueur, drôle pour les participants qui le perdent.
5. Les beaux buts de joueurs du pool.
6. Fermeture : rendez-vous demain, avec une dernière pointe.

À L'ORAL
- Phrases courtes, français québécois naturel (« pis », « mets-en », « ben là », « voyons donc »),
  nombres en chiffres, aucun émoji, aucune abréviation (dis « défenseur », pas « D »; « blessé », pas « IR »).
- Les noms d'équipe bizarres (SK|MADDOXG) : dis plutôt le prénom du participant.
- Entre 300 et 420 mots au total, 14 à 26 répliques qui alternent, chacune de 1 à 3 phrases.
- Avec parcimonie (5 à 8 fois en tout), des indications de jeu entre crochets en anglais que la synthèse
  vocale interprète : [laughs], [chuckles], [excited], [sighs], [whispers], [sarcastic], [gasps].

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code :
{"lines": [{"host": "sylvie", "line": "..."}, {"host": "jean", "line": "..."}]}

"""


def valid(script):
    lines = script.get("lines") if isinstance(script, dict) else None
    return (isinstance(lines, list) and 8 <= len(lines) <= 32
            and all(isinstance(x, dict) and x.get("host") in HOSTS and isinstance(x.get("line"), str)
                    and 0 < len(x["line"]) <= 450 for x in lines))


def show_facts(f, history):
    """Everything the show may talk about, and what the earlier shows already said."""
    previous = [h for h in history if h["gameDay"] < f["night"]]
    last = previous[-1] if previous else {}
    out = dict(f)
    # Season awards (snub, golden pick, ice anchor) change rarely: only pass along the ones that changed
    said = last.get("awards", {})
    out["awards"] = {k: v for k, v in f["awards"].items() if v and said.get(k) != v.get("id")}
    try:
        out["bingo"] = bingo_facts(f["night"])
        out["standings"] = site_order(f["standings"], out["bingo"].pop("linesById", {}))
    except Exception as e:  # noqa: BLE001 - the show goes on without its bingo segment
        print(f"warning: no bingo facts ({e})")
    before = last.get("injured")
    out["injuries"], injured = injury_facts(before if isinstance(before, dict) else None)
    out["notes"] += (" bingo: last night's bingo cards (tonight = that night's results; season = the race for "
                     "the year-end bingo prize). injuries: new = hurt since the previous show; statusChanged = "
                     "worse or better since then (was = old status); ownedBy = pool participants who have the player. awards only lists the ones that changed since the last show.")
    deja = "\n\n".join(f"Émission du {h['gameDay']} :\n" + "\n".join(f"{x['host']}: {x['line']}" for x in h["lines"])
                       for h in previous[-3:])
    awards = {k: v.get("id") for k, v in f["awards"].items() if v}
    return out, deja, {"injured": injured, "awards": awards}


def write_script(f, deja):
    with tempfile.TemporaryDirectory() as tmp:  # empty cwd: no project instructions or memory
        run = subprocess.run(
            [CLAUDE, "-p", "--model", "opus", "--output-format", "json", "--tools", "",
             "--strict-mcp-config", "--no-session-persistence"],
            input=(PROMPT + "DÉJÀ DIT (émissions précédentes, à ne pas répéter) :\n" + (deja or "(aucune)")
                   + "\n\nFAITS :\n" + json.dumps(f, ensure_ascii=False, indent=1)),
            capture_output=True, text=True, timeout=600, cwd=tmp)
    if run.returncode != 0:
        raise RuntimeError(f"claude exited {run.returncode}: {(run.stderr or run.stdout)[-400:]}")
    reply = json.loads(run.stdout).get("result", "").strip()
    script = json.loads(reply[reply.find("{"):reply.rfind("}") + 1])
    if not valid(script):
        raise ValueError(f"unexpected script shape: {reply[:300]}")
    return script["lines"]


def eleven(lines, path):
    """The whole show as one ElevenLabs dialogue (natural turn-taking, audio tags). Returns bits/s."""
    key = KEY_FILE.read_text().strip()
    voices = ((load("config.json", {}) or {}).get("radio") or {}).get("voices") or {}
    if not all(voices.get(h) for h in HOSTS):
        raise RuntimeError('no ElevenLabs voices in config.json ("radio": {"voices": {...}})')
    # 32 kbit/s is plenty for voices and keeps each day's file (and the repo's history) small
    res = requests.post(f"{ELEVEN}/text-to-dialogue", params={"output_format": "mp3_22050_32"},
                        headers={"xi-api-key": key}, timeout=600,
                        json={"model_id": "eleven_v3",
                              "inputs": [{"text": x["line"], "voice_id": voices[x["host"]]} for x in lines]})
    if not res.ok:
        raise RuntimeError(f"ElevenLabs {res.status_code}: {res.text[:300]}")
    Path(path).write_bytes(res.content)
    return 32000


async def edge(lines, path):
    """Free fallback: each line read by Microsoft's Québécois voices; MP3 pieces join end to end."""
    import edge_tts  # uv run --with edge-tts
    with open(path, "wb") as out:
        for x in lines:
            text = re.sub(r"\[[a-z ]+\]\s*", "", x["line"])  # audio tags are for ElevenLabs only
            async for chunk in edge_tts.Communicate(text, EDGE_VOICES[x["host"]], rate="+4%").stream():
                if chunk["type"] == "audio":
                    out.write(chunk["data"])
    return 48000  # edge-tts: 24 kHz mono MP3 at 48 kbit/s


def voice(lines, path):
    """ElevenLabs when its key is on this PC, else (or if it fails) the free voices. Returns (engine, bits/s)."""
    if KEY_FILE.exists():
        try:
            return "elevenlabs", eleven(lines, path)
        except Exception as e:  # noqa: BLE001
            print(f"warning: ElevenLabs failed, using the free voices ({e})")
    return "edge", asyncio.run(edge(lines, path))


def main(args):
    f = facts()
    if not f["games"]:
        print(f"radio: no games on {f['night']}, no show")
        return
    old = load("radio.json", {}) or {}
    if old.get("gameDay") == f["night"] and "--force" not in args and "--dry-run" not in args:
        print(f"radio: show already made for {f['night']}")
        return
    history = (load("radio_history.json", {}) or {}).get("shows", [])
    full, deja, memory = show_facts(f, history)
    try:
        lines = write_script(full, deja)
    except Exception as e:  # never block the morning job
        print(f"warning: no radio show: {e}")
        return
    if "--dry-run" in args:
        print(json.dumps({k: full[k] for k in ("bingo", "injuries", "awards") if k in full}, ensure_ascii=False, indent=1))
        print("\n".join(f"{x['host'].upper()}: {x['line']}" for x in lines))
        return
    tmp = DATA_DIR / "radio.mp3.part"
    try:
        engine, bitrate = voice(lines, tmp)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(f"warning: no radio show (voices): {e}")
        return
    tmp.replace(DATA_DIR / "radio.mp3")
    seconds = round((DATA_DIR / "radio.mp3").stat().st_size * 8 / bitrate)
    save("radio.json", {"gameDay": f["night"], "generatedAt": now_iso(), "duration": seconds,
                        "engine": engine, "lines": lines})
    # Remember this show (one per game day) so the next ones don't repeat it
    shows = [h for h in history if h["gameDay"] != f["night"]] + [{"gameDay": f["night"], "lines": lines, **memory}]
    save("radio_history.json", {"shows": sorted(shows, key=lambda h: h["gameDay"])[-HISTORY_DAYS:]})
    print(f"radio: {len(lines)} lines, {seconds // 60}:{seconds % 60:02d} ({engine}), "
          f"bingo {'in' if 'bingo' in full else 'missing'}, {len(full['injuries']['new'])} new injuries")


if __name__ == "__main__":
    main(sys.argv[1:])
