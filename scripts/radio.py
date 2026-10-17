#!/usr/bin/env python3
"""« Les Ondes de la Patinoire »: a 2-3 minute morning radio show about last night.

Claude writes a two-host dialogue (Sylvie and Jean) from the same facts as the front-page recap
(recap.facts()); ElevenLabs then voices it as one conversation (text-to-dialogue, eleven_v3).
The API key stays on Hugo's PC in ~/pool_patinoire_elevenlabs.txt (never in the repo); the two
voice ids are in data/config.json ("radio": {"voices": {"sylvie": ..., "jean": ...}}). Without a
key, or if ElevenLabs fails, Microsoft's free Québécois voices read it instead (edge-tts package).
Output: data/radio.mp3 and data/radio.json (with the transcript).
Runs on Hugo's PC after the recap (scripts/local/pool_job.sh morning); any failure keeps the
previous show, which the site stops showing once it's old. Off switch: "features": {"radio": false}
in data/config.json.

  uv run --with edge-tts --with requests python scripts/radio.py            last night's show
  uv run --with edge-tts --with requests python scripts/radio.py --force    rewrite it anyway
  python scripts/radio.py --dry-run                         print the dialogue only, no audio
"""
import asyncio
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import requests

from pool_lib import DATA_DIR, load, now_iso, save
from recap import CLAUDE, facts

HOSTS = ("sylvie", "jean")
KEY_FILE = Path.home() / "pool_patinoire_elevenlabs.txt"
ELEVEN = "https://api.elevenlabs.io/v1"
EDGE_VOICES = {"sylvie": "fr-CA-SylvieNeural", "jean": "fr-CA-JeanNeural"}  # the free fallback

PROMPT = """Tu écris le texte de « Les Ondes de la Patinoire », une émission de radio de 2 à 3 minutes
sur le « Pool à Hugo », un pool de hockey LNH entre amis et famille au Québec. Deux animateurs :
Sylvie (énergique, pince-sans-rire) et Jean (enthousiaste, un brin chauvin pour le Canadien).
L'émission est diffusée le MATIN : on dit « bonjour », jamais « bonsoir ».

À partir des FAITS ci-dessous sur les matchs d'hier soir :
- Utilise UNIQUEMENT les faits fournis. N'invente aucune statistique, aucun score, aucun nom.
- Ouverture : salutation à « la famille » et présentation; fermeture : rendez-vous ce soir ou demain.
- Parle surtout des participants (prénoms) : gros gains de la soirée, remontées, glissades, la course
  en tête et la lanterne rouge; puis les beaux buts de joueurs du pool. Taquineries légères, jamais méchant.
- Écris pour l'oral : phrases courtes, français québécois naturel (« pis », « mets-en », « ben là »),
  nombres en chiffres, aucun émoji, aucune abréviation de position (dis « défenseur », pas « D »).
  Les noms d'équipe bizarres (SK|MADDOXG) : dis plutôt le prénom du participant.
- Entre 280 et 380 mots au total, 12 à 22 répliques qui alternent, chacune de 1 à 3 phrases.
- Tu peux ajouter, avec parcimonie (4 à 6 fois en tout), des indications de jeu entre crochets en anglais
  que la synthèse vocale interprète : [laughs], [chuckles], [excited], [sighs], [whispers], [sarcastic].

Réponds avec SEULEMENT ce JSON, sans texte autour ni bloc de code :
{"lines": [{"host": "sylvie", "line": "..."}, {"host": "jean", "line": "..."}]}

FAITS :
"""


def valid(script):
    lines = script.get("lines") if isinstance(script, dict) else None
    return (isinstance(lines, list) and 8 <= len(lines) <= 30
            and all(isinstance(x, dict) and x.get("host") in HOSTS and isinstance(x.get("line"), str)
                    and 0 < len(x["line"]) <= 400 for x in lines))


def write_script(f):
    with tempfile.TemporaryDirectory() as tmp:  # empty cwd: no project instructions or memory
        run = subprocess.run(
            [CLAUDE, "-p", "--model", "sonnet", "--output-format", "json", "--tools", "",
             "--strict-mcp-config", "--no-session-persistence"],
            input=PROMPT + json.dumps(f, ensure_ascii=False, indent=1),
            capture_output=True, text=True, timeout=300, cwd=tmp)
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
    res = requests.post(f"{ELEVEN}/text-to-dialogue", params={"output_format": "mp3_44100_128"},
                        headers={"xi-api-key": key}, timeout=600,
                        json={"model_id": "eleven_v3",
                              "inputs": [{"text": x["line"], "voice_id": voices[x["host"]]} for x in lines]})
    if not res.ok:
        raise RuntimeError(f"ElevenLabs {res.status_code}: {res.text[:300]}")
    Path(path).write_bytes(res.content)
    return 128000


async def edge(lines, path):
    """Free fallback: each line read by Microsoft's Québécois voices; MP3 pieces join end to end."""
    import re

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
    try:
        lines = write_script(f)
    except Exception as e:  # never block the morning job
        print(f"warning: no radio show: {e}")
        return
    if "--dry-run" in args:
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
    print(f"radio: {len(lines)} lines, {seconds // 60}:{seconds % 60:02d} ({engine})")


if __name__ == "__main__":
    main(sys.argv[1:])
