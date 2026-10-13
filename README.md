# Le Pool à Hugo — 2026-27

The family hockey pool site: https://hberube.github.io/patinoire/ (repo `hberube/patinoire`)

A static site on GitHub Pages, with no server and no database. The data lives in `data/*.json`. GitHub Actions refreshes it from the official NHL stats and commits it back to the repo.

| Tab | What it shows |
|---|---|
| Classement | Podium, awards, standings with daily movement and a 2-week trend |
| Gazette | Last night's pool goals (NHL.com clips), weekly duels with season records, Golden Pick / Ice Anchor / Snub badges, milestones to watch |
| Équipes | Every team, its "edge" players (points few others have), and its full roster with unique picks |
| Trajectoire | Points per day; compare up to 3 teams |
| Ce soir | Tonight's games, the pool players in each one, who has the most at stake, and live goals/assists |
| Échanges | Rules, approved trades, and the trade builder (requires login) |
| FAQ | Step-by-step help for participants: changing their photo or team logo, proposing a trade, login/PIN, scoring, update times |

## Rules (in `data/config.json`)

- Scoring, from the form: goal 1, assist 1, goalie win 1, shutout +2. Goalies also get credit for goals and assists.
- Trades: 1 F, 1 D and 1 G per team, starting January 1, 2027.
- A player can only be swapped for another player from **the same round** of the form (`data/groups.json`).
- A traded-away player's points stay with the team. The new player only counts from the moment the trade is approved.

## How updates happen

**Nothing updates by itself until the code is on GitHub.** On your computer, the site shows whatever data was last downloaded. Once it's pushed (see *One-time setup* below), GitHub does everything on its own servers. Your computer doesn't need to be on.

Each update follows the same steps:

1. A GitHub Actions workflow runs.
2. It gets the official NHL stats.
3. It rewrites the files in `data/` and saves them back to the repo.
4. GitHub Pages republishes the site about a minute later.

Visitors see the new numbers the next time they open or reload the page.

| When | Workflow | What changes on the site |
|---|---|---|
| Every morning at 05:00 EDT (04:00 EST in winter) | `daily-stats-update.yml` | Standings, points, rank arrows, trajectory, Gazette (last night's goals, badges, milestones). Pulls season stats (3 NHL API calls), rebuilds `leaderboard.json`, adds a day to `history.json`, then writes `insights.json` (about 75 paced game-log calls, ~1 min; if this last step fails, the standings still update). |
| Every 15 min, noon–2 AM ET | `live-scores.yml` | "Ce soir": scores and live goals/assists (`live.json`). Commits only when something changed. |
| When you click **Approuver** on a trade | `process-trade.yml` | Checks the trade, swaps the player, banks the points, rebuilds the standings (~2–3 min). |
| When you click **Publier** on a team image | `set-logo.yml` | Converts the image to 256px WebP in `img/teams/` and updates `data/logos.json` (~2–3 min). |

**Run an update right now:** use **Mettre à jour les stats maintenant** in `/admin/` (section 4), or on GitHub go to **Actions → Daily Pool Stats Update → Run workflow**. Each workflow's history and logs are on the **Actions** tab. A red ❌ means that run failed; click it to see why.

**The Windows Task Scheduler is no longer needed.** Once the site runs on GitHub, turn the old scheduled task off.

### Running updates by hand (local testing, or if GitHub is down)

```bash
cd ~/workspace/agentic-workspace/agentic_hockey_pool
pip install -r requirements.txt        # once
python3 scripts/update_pool.py         # standings + history
python3 scripts/insights.py            # Gazette (~1 min)
python3 scripts/update_live.py         # "Ce soir" scores
```

To view the site on your computer:

```bash
python3 -m http.server 8000            # then open http://localhost:8000
```

Opening `index.html` straight from the file explorer won't work, because browsers block the data files that way. If you ran the scripts by hand and want the result online, commit and push the `data/` folder.

## Emailing everyone

`/admin/`, section **3. Courriel à tous**, prepares an email to all participants and opens it in your Gmail (or your default mail app). You read it over and send it yourself; the site never sends anything on its own.

- Load your contacts first (section 2). The addresses come from your local `roster_2027.txt` and stay in your browser.
- Everyone is put in **BCC**, so nobody sees the others' addresses. Untick people under *Destinataires* to leave them out.
- Pick a template ("Le nouveau site est en ligne", "La période d'échanges est ouverte", or a blank one), edit it, then click **Ouvrir dans Gmail**.
- **Copier les adresses** copies the list, to paste into the BCC field of any email program.

## Sharing a FAQ answer

Send a link that opens a specific question in the FAQ tab: add `?q=<section>-<question>` (counting from 0), for example:

- How to change a photo or logo: https://hberube.github.io/patinoire/?q=0-0#faq
- How to propose a trade: https://hberube.github.io/patinoire/?q=1-1#faq
- Trade rules: https://hberube.github.io/patinoire/?q=1-0#faq

The FAQ text lives in `js/faq.js` (French and English). Trade limits, the trade window date and the scoring are filled in from `data/config.json`.

## Approving a trade

1. A participant logs in, opens **Échanges**, picks a player to drop and a player from the same round to add, then sends you the generated message by text or email.
2. Tap the **Approuver** link in the message, or paste the message in `/admin/`.
3. The admin page checks the trade (window open, quota, same round) and shows the participant's email.
   **Check that the message really came from that address or their phone**, tick the box, then click **Approuver l'échange**.
4. The standings update about 2–3 minutes later.

To reject a trade, just don't approve it.

## Faces and team logos

Each participant has two images: their **face** (round) and their **team logo** (rounded square). They show up everywhere:

| Where | How it's shown |
|---|---|
| Podium, team window, "Mon équipe" | Big face, logo in the corner |
| Standings rows, team cards | Face and logo side by side |
| Small spots (Gazette owners, "Ce soir" stakes) | Face only |

Someone with no image gets coloured initials.

**Changing an image:**

1. The participant logs in, goes to **Équipes → Changer mon image**, picks *Logo d'équipe* or *Ma photo*, and taps **Envoyer à Hugo**. Phones open the share sheet; computers save the file and open an email.
2. You open `/admin/`, section **6. Images d'équipe**. Pick the person and the image type, choose the file they sent, and click **Publier l'image**. It's live 2–3 minutes later.

By hand: `python scripts/set_logo.py usr_eve logo picture.png`, or `usr_eve face …` for the photo. Then commit `img/teams/` and `data/logos.json`.

Every image is re-encoded to 256×256 WebP (photos are center-cropped, logos with transparency are kept whole). The 2026-27 images came from the old site (`img/<name>.png` faces, `img/teamLogo/<name>.png` logos).

## One-time setup

This lives in its own repo, **`hberube/patinoire`**. The old site (`hberube/la-patinoire`) is left untouched and keeps working at its old address until you retire it.

1. **Create the repo.** On github.com, go to **New repository**, name it `patinoire`, and make it **Public** (free GitHub Pages needs that). Don't add a README, `.gitignore` or license, because this folder already has them.
2. **Push this folder.** From this project folder:
   ```bash
   git remote add origin https://github.com/hberube/patinoire.git
   git push -u origin main
   ```
   When git asks for a password, use a GitHub token, not your account password, or sign in with GitHub Desktop / VS Code.
3. **Turn on Pages and Actions.** In the repo's Settings:
   - **Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
   - **Actions → General → Workflow permissions** → **Read and write permissions**. Save.

   The site appears at https://hberube.github.io/patinoire/ within a few minutes.
4. **Smoke test.** Go to **Actions → Daily Pool Stats Update → Run workflow**. It should finish green and commit fresh `data/*.json`.
5. **Create a token for the admin page.** On github.com go to Settings → Developer settings → **Fine-grained tokens** → Generate. Set *Repository access: Only select repositories* → `patinoire`, and *Permissions → Actions: Read and write*, nothing else. Paste it in `/admin/`, section 4; it stays in that browser only. The admin page works out which repo it's in from its own address, so nothing needs editing.
6. **Load your contacts once.** In `/admin/`, section 2, choose your local `roster_2027.txt` (the form export). The emails are kept only in that browser. `roster_2027.txt` is in `.gitignore` and must never be committed.
7. **Send each person their PIN** (list generated by `scripts/make_pins.py`, not stored anywhere).
   - Reset a PIN: `python scripts/make_pins.py usr_eve` (random) or `python scripts/make_pins.py usr_eve 1234`, then commit and push `data/users.json`.
8. **Retire the old site when you're ready.** Turn off its scheduled jobs (old repo → Actions → disable the workflows), or the Windows Task Scheduler task if it was updating from your PC. Optionally replace its `index.html` with a link to the new address.

## Security and what's public

The repo is public, as GitHub Pages requires on a free plan, so everything in `data/` can be read by anyone. It contains:

- names and team names
- picks and stats
- PIN hashes

It contains **no** emails, real passwords or tokens. Participants' emails stay in your local `roster_2027.txt` (git-ignored) and in your admin browser.

- **Who sent a trade.** The PIN login is a convenience. The real proof is that the trade message came from the participant's own email or phone; the admin page shows the expected address and won't approve until you confirm it.
- **PINs.** They're salted and hashed (PBKDF2), never stored in plain text. A 4-digit PIN can still be brute-forced by someone determined. That's acceptable here because a login can only *build* a trade request: nothing changes until you approve it.
- **Writes.** Only the workflows write to the repo, with GitHub's own short-lived token. The admin page's token lives only in your browser and can only trigger workflows. If a device is lost, revoke the token on GitHub; nothing else is exposed.
- **Workflow inputs.** The trade code is passed as an environment variable, never pasted into a shell command, and `execute_trade.py` re-validates everything.
- **Inactivity.** GitHub pauses scheduled workflows after 60 days with no repo activity. The daily commits keep it active during the season.

## Re-importing the draft

`python scripts/build_rosters.py` reads `scripts/form_rounds_2026-27.txt` (the 21 rounds of the Google Form) and `roster_2027.txt` (the Google Form export, tab-separated; emails are ignored), resolves NHL player IDs, and writes `groups.json` and `rosters.json`. Names it can't resolve go in `scripts/roster_overrides.json`. Then run `python scripts/history.py --backfill` and `python scripts/update_pool.py`. **Only do this before any trade:** it resets rosters.
