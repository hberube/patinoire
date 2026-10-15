# Local backup jobs (Windows Task Scheduler → WSL)

GitHub's schedule skips runs for hours at a time, so Hugo's PC runs the same jobs as a backup.
Both are harmless when GitHub does run: they produce the same data, and a duplicate copy of a job exits right away.

| Task | When (Eastern) | Does |
|---|---|---|
| `Patinoire - Ce soir` | daily 12:05 PM | `pool_job.sh night`: keeps "Ce soir" live until the last game, then rebuilds the standings |
| `Patinoire - Classement` | daily 4:30 AM, wakes the PC | `pool_job.sh morning`: rebuilds the standings, records the history chart, then has Claude write the front-page recap (`scripts/recap.py` → `data/recap.json`) with a meme card (`scripts/meme.py`; turn off with `"recapMeme": false` in `data/config.json`) |

The tasks run `~/.local/bin/patinoire_job.sh`, a copy of `pool_job.sh` (a copy, so the job never reads a file it is updating).
It works in its own clone, `~/patinoire-bot`, and logs to `~/patinoire-bot-night.log` / `~/patinoire-bot-morning.log`.

After changing `pool_job.sh`, re-copy it:

```bash
install -m 755 scripts/local/pool_job.sh ~/.local/bin/patinoire_job.sh
```

The recap needs the Claude Code CLI at `~/.local/bin/claude`, logged in once:
`curl -fsSL https://claude.ai/install.sh | bash`, then run `claude` and sign in. Without it the
morning job still updates the standings and just skips the recap.

Pushes use Git Credential Manager, so the PC must be on with Hugo logged in (sleeping is fine for the morning task).
