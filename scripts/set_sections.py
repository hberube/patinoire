#!/usr/bin/env python3
"""Hide tabs and turn features off for everyone (the admin page's "Sections du site", through the
site-sections.yml workflow). Writes data/config.json: "hiddenTabs" and the "features" switches.

  HIDDEN_TABS=chart,faq FEATURES_OFF=radio python scripts/set_sections.py
Anything not listed is shown / switched on. Classement (standings) can't be hidden.
"""
import json
import os
import sys
from pathlib import Path

# No pool_lib import: the workflow installs nothing
DATA_DIR = Path(os.environ.get("POOL_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

TABS = {"gazette", "teams", "chart", "tonight", "bingo", "injuries", "trades", "faq"}
FEATURES = {"radio", "segments", "arena", "cards", "pourtoi", "horoscope", "wrapped", "badges", "rival",
            "myGames", "regrets", "whatif", "advisor", "look"}


def listed(name, allowed):
    items = [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]
    bad = [x for x in items if x not in allowed]
    if bad:
        sys.exit(f"{name}: unknown {', '.join(bad)}")
    return items


def main():
    tabs, off = listed("HIDDEN_TABS", TABS), listed("FEATURES_OFF", FEATURES)
    path = DATA_DIR / "config.json"
    config = json.loads(path.read_text(encoding="utf-8"))
    config["hiddenTabs"] = sorted(tabs)
    features = config.setdefault("features", {})
    for k in FEATURES:
        features[k] = k not in off
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"hidden tabs: {', '.join(tabs) or 'none'}; features off: {', '.join(off) or 'none'}")


if __name__ == "__main__":
    main()
