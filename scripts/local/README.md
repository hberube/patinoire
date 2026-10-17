# Local backup jobs (Windows Task Scheduler → WSL)

GitHub's schedule skips runs for hours at a time, so Hugo's PC runs the same jobs as a backup.
Both are harmless when GitHub does run: they produce the same data, and a duplicate copy of a job exits right away.

| Task | When (Eastern) | Does |
|---|---|---|
| `Patinoire - Ce soir` | daily 12:05 PM | `pool_job.sh night`: keeps "Ce soir" live until the last game, then rebuilds the standings |
| `Patinoire - Classement` | daily 4:30 AM, wakes the PC | `pool_job.sh morning`: rebuilds the standings, records the history chart, then has Claude write the front-page recap (`scripts/recap.py` → `data/recap.json`) with a meme card (`scripts/meme.py`; turn off with `"recapMeme": false` in `data/config.json`) |
| `Patinoire - Surveillance` | every 30 minutes | `overseer.sh`: runs `scripts/healthcheck.py` and re-runs whatever fell behind (`pool_job.sh standings`, `morning`, `night` or `live`); alerts Hugo's phone if a repair didn't work |

The tasks run `~/.local/bin/patinoire_job.sh`, a copy of `pool_job.sh` (a copy, so the job never reads a file it is updating).
It works in its own clone, `~/patinoire-bot`, and logs to `~/patinoire-bot-night.log` / `~/patinoire-bot-morning.log`.

After changing `pool_job.sh` or `overseer.sh`, re-copy them:

```bash
install -m 755 scripts/local/pool_job.sh ~/.local/bin/patinoire_job.sh
install -m 755 scripts/local/overseer.sh ~/.local/bin/patinoire_overseer.sh
```

## The overseer

`scripts/healthcheck.py` is the checklist: from what's published on GitHub and the NHL schedule, it
knows what should be true at each hour (standings with last night's games once they're final, the
recap by 5:30 AM, "Ce soir" on today from 12:15 PM and refreshing during games, Pages serving main).
Run it by hand any time: `python3 scripts/healthcheck.py`.

`overseer.sh` repairs in the background, then checks again 30 minutes later. A problem that's still
there, or one no job here can fix (a stuck Pages deploy), is sent once to Hugo's phone through the
ntfy app, then a "réglé ✅" when it clears. The topic name is in `~/pool_patinoire_ntfy.txt` (private,
outside the repo); subscribe to it in the ntfy app. Log: `~/patinoire-bot-overseer.log`.

A cloud check (a scheduled Claude routine) runs the same `healthcheck.py` a few times a day and
alerts the same topic, so a PC that's off or signed out doesn't go unnoticed.

The recap needs the Claude Code CLI at `~/.local/bin/claude`, logged in once:
`curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` and sign in. Without it the
morning job still updates the standings and just skips the recap.

Pushes use Git Credential Manager, so the PC must be on with Hugo logged in (sleeping is fine for the morning task).
