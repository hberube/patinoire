#!/usr/bin/env python3
"""Create PINs for participants and store salted PBKDF2 hashes in data/users.json.

Usage:
  python scripts/make_pins.py                 # PIN for every roster participant without one
  python scripts/make_pins.py usr_eve 4821    # set a specific PIN for one participant
  python scripts/make_pins.py usr_eve         # reset one participant to a new random PIN

Plaintext PINs are printed once and never stored. Send each person their own PIN.
The hash must match js/auth.js (PBKDF2-SHA256, 100k iterations, 16-byte hex salt).
"""
import hashlib
import secrets
import sys

from pool_lib import load, save

ITERATIONS = 100_000
ADMINS = {"usr_hugo_berube"}


def hash_pin(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), ITERATIONS).hex()


def new_entry(participant_id, name, pin):
    salt = secrets.token_hex(16)
    return {
        "participantId": participant_id,
        "displayName": name,
        "role": "admin" if participant_id in ADMINS else "participant",
        "salt": salt,
        "pinHash": hash_pin(pin, salt),
    }


def main(args):
    rosters = load("rosters.json")
    users = {u["participantId"]: u for u in load("users.json", [])}
    names = {r["participantId"]: r["participantName"] for r in rosters}

    if args:
        pid = args[0]
        if pid not in names:
            sys.exit(f"Unknown participant {pid}. Known: {', '.join(names)}")
        targets = {pid: args[1] if len(args) > 1 else None}
    else:
        targets = {pid: None for pid in names if pid not in users}

    issued = []
    for pid, pin in targets.items():
        pin = pin or f"{secrets.randbelow(10_000):04d}"
        users[pid] = new_entry(pid, names[pid], pin)
        issued.append((names[pid], pid, pin))

    save("users.json", [users[pid] for pid in names if pid in users])
    for name, pid, pin in issued:
        print(f"{name:<22} {pid:<26} PIN {pin}")
    if not issued:
        print("Every participant already has a PIN.")


if __name__ == "__main__":
    main(sys.argv[1:])
