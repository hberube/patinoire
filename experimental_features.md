# Feature Concepts & UX Enhancements: Family Hockey Pool (`la-patinoire`)

> **Note on Feature Scope:**  
> The items detailed in this document are strictly **Labs / Alpha / Experimental Features**. They are proposed concepts designed to enrich user engagement, but are not mandatory core requirements. If any feature adds undue maintenance, breaks client-side performance, or does not make architectural or practical sense for the static GitHub Pages deployment, **do not implement it** or discard it without blocking the core pool functionality.

---

## Architectural Context
All experimental features below are specifically tailored for a **zero-cost, serverless deployment on GitHub Pages (`https://hberube.github.io/la-patinoire/`)**. 

They require no dedicated backend servers, databases, or hosting runtime. All data computation happens either:
1. **At build time / scheduled run (05:00 EDT)** via Python in GitHub Actions, writing outputs to lightweight JSON files in `/data`.
2. **At client runtime** via vanilla JavaScript in the browser consuming the pre-built JSON datasets.

---

## 1. [Labs / Experimental] "The Morning Ice Melt" (Daily Banter & Pool Recap)
* **Status:** Experimental / Optional
* **User Experience:** A prominent, witty 2-to-3 paragraph morning sports column at the very top of the homepage celebrating the night's biggest winners and poking fun at the losers.
* **Why It’s Original:** Instead of cold numbers, it delivers narrative storytelling tailored to the family dynamic:
  > *"Ève shot up 2 spots on the leaderboard this morning courtesy of Matthews' hat trick, while Hugo’s goaltending gamble completely melted down against Montreal."*
* **GitHub Pages Implementation:**
  * During the scheduled 05:00 EDT GitHub Actions workflow, calculate point deltas from the previous day.
  * Pass the point swings into a lightweight LLM API step (using GitHub Secrets) to draft a fun, 3-paragraph recap.
  * Commit the generated output to `data/daily_recap.json`.
  * The frontend renders this inside a retro newspaper-style hero card.

---

## 2. [Labs / Experimental] "Pool Goals of the Night" (Automated Video Highlight Reel)
* **Status:** Experimental / Optional
* **User Experience:** A video carousel or thumbnail strip positioned directly below the standings featuring video clips of goals scored *only by rostered pool players* from the previous evening.
* **Why It’s Original:** Eliminates the need to search NHL.com, YouTube, or social media to find individual clips. Users open the family pool site and immediately watch their own players' scoring plays.
* **GitHub Pages Implementation:**
  * The official NHL Edge public API (`https://api-web.nhle.com/v1/gamecenter/{gameId}/play-by-play`) contains direct CDN links to official NHL MP4 highlight video clips for scoring events.
  * During the morning Python run, identify which rostered players scored goals, fetch their corresponding highlight video URLs, and save them to `data/highlights.json`.
  * The frontend displays these clips using native HTML5 `<video>` elements or responsive modal popups.

---

## 3. [Labs / Experimental] Head-to-Head "Rivalry Matchups of the Week"
* **Status:** Experimental / Optional
* **User Experience:** A dedicated card showcasing a rolling 7-day micro-matchup between family members (e.g., *Hugo vs. Ève* or *Dad vs. Son*), complete with a live delta counter and a weekly virtual bragging-rights badge.
* **Why It’s Original:** In traditional season-long pools, participants who fall behind by mid-season often disengage. Micro-rivalries maintain weekly excitement and banter regardless of overall rank.
* **GitHub Pages Implementation:**
  * Maintain rolling 7-day point histories inside `data/season_master.json`.
  * Pure client-side JavaScript calculates the 7-day delta between matched participants dynamically—requiring no additional API calls or server processing.

---

## 4. [Labs / Experimental] "Busts & Steals" (The Draft Regret Index)
* **Status:** Experimental / Optional
* **User Experience:** A set of tongue-in-cheek badges updated daily:
  * 🌟 **The Golden Pick:** The lowest-drafted or lowest-cost player currently putting up elite, top-tier production.
  * 🧊 **The Ice Anchor:** A superstar who hasn't registered a point in 5 consecutive games, dragging down their owner.
  * 🤦 **The Snub:** The highest-scoring unowned NHL player who went undrafted across all rosters.
* **Why It’s Original:** Sparks active debate in family chats and directly informs trade strategies leading up to the January trade window.
* **GitHub Pages Implementation:**
  * Computed during the Python morning run by comparing individual production against team averages.
  * Written directly into `data/awards.json` and rendered as graphical badges on player cards.

---

## 5. [Labs / Experimental] "Tonight's Stakes" (Daily Active Player Radar)
* **Status:** Experimental / Optional
* **User Experience:** An interactive game board showing today’s upcoming NHL matchups, explicitly tagged with **which family members have players suiting up tonight**.
* **Why It’s Original:** Gives participants an immediate rooting interest before tuning into an evening broadcast:
  > *"7:00 PM: Boston vs. Florida — Ève owns Pastrňák, Hugo owns Bobrovsky. 2 points on the line!"*
* **GitHub Pages Implementation:**
  * Query the NHL schedule endpoint (`https://api-web.nhle.com/v1/schedule/now`) during the morning build.
  * Cross-reference today's active teams with participants' rosters and store the match matrix in `data/tonight_stakes.json`.
  * Render as a clean game schedule ticker on the UI.

---

## 6. [Labs / Experimental] Interactive Roster "Trade Machine" Simulator
* **Status:** Experimental / Optional
* **User Experience:** A sandbox tool in the user portal where participants can preview trade scenarios before submitting them to the commissioner.
* **Why It’s Original:** Selecting a hypothetical swap (e.g., *Trade Draisaitl for Matthews*) instantly calculates:
  * Point differential to date.
  * Projected end-of-season points based on current per-game pace.
  * Remaining games on both NHL teams' schedules.
* **GitHub Pages Implementation:**
  * 100% client-side JavaScript.
  * Runs entirely against the cached player stats already downloaded in `data/season_master.json`.

---

## 7. [Labs / Experimental] Dynamic "Rink Thermometer" Visual Lineup
* **Status:** Experimental / Optional
* **User Experience:** An interactive SVG hockey rink layout. Clicking a participant visually positions their players on the ice (Left Wing, Center, Right Wing, Defense pair, Goalie in the crease) with glow effects representing recent form (hot/cold streaks based on the last 5 games).
* **Why It’s Original:** Upgrades the presentation from a basic tabular spreadsheet to an immersive sports-card experience.
* **GitHub Pages Implementation:**
  * Responsive CSS Grid/SVG template rendered directly in vanilla JavaScript without external UI libraries.

---

## 8. [Labs / Experimental] Milestone Watch & Trophy Tracker
* **Status:** Experimental / Optional
* **User Experience:** A live progress ticker tracking upcoming player milestones and pool-wide achievements:
  * *"McDavid is 2 goals away from 40 (Hugo's Roster)"*
  * *"Ève is 3 points away from taking 1st place"*
* **Why It’s Original:** Provides daily micro-goals for participants to follow during games rather than solely focusing on final standings.
* **GitHub Pages Implementation:**
  * Evaluated during the daily stats script and published to `data/milestones.json`.