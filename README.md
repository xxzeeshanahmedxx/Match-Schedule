# 🏆 Rocket League Championship — Tournament Tracker

A full-stack tournament tracker for the **Rocket League Championship** with 5 players, 20 group-stage matches, a semi-final/3rd-place match, and a grand final.

## ✨ Features

- 🎮 **Public page** — players, live standings, full match schedule, knockout bracket
- 🛠 **Admin panel** — password-protected score entry for every match
- 📊 **Auto-calculated standings** — sorted by points → goal difference → goals scored → wins
- 🏆 **Dynamic knockout** — top 2 advance to Final, 3rd & 4th to Semi Final/3rd-place match (locks after group stage)
- 🔴 **Live match states** — admin can mark matches live, complete, or reset
- 🗓 **Match scheduling** — admin can add or edit each match date, kickoff time, and game mode
- 📱 **Mobile-first UI** — compact phone layout with two match cards per row
- 💾 **Persistent storage** — local JSON for Express dev, Cloudflare D1 for Pages deployment
- 🔄 **Auto-refresh** — public page polls every 30 s for live updates

## 🛠 Tech Stack

- **Backend:** Node.js + Express for local/Node hosting, plus Cloudflare Pages Functions for D1 hosting
- **Storage:** JSON file locally; Cloudflare D1 (`kv` table) in production on Cloudflare Pages
- **Frontend:** Vanilla HTML + CSS + JavaScript — no build step
- **Auth:** Simple bearer-token admin sessions; in-memory locally, D1-backed on Cloudflare

## 🚀 Quick Start

```bash
# 1. Install
npm install

# 2. (optional) Set a custom admin password
export ADMIN_PASSWORD=yourSecretPassword

# 3. Run
npm start

# 4. Open in browser
#    Public:  http://localhost:3000/
#    Admin:   http://localhost:3000/admin
```

Default admin password is **`rocket2026`** — change it with the `ADMIN_PASSWORD` env var.

Examples:

```bash
# macOS/Linux
ADMIN_PASSWORD=myNewPassword npm start

# Windows PowerShell
$env:ADMIN_PASSWORD="myNewPassword"; npm start
```

On Render/Railway/Fly/etc., set `ADMIN_PASSWORD` in the service's Environment Variables / Secrets page, then redeploy or restart the service.

## 📜 NPM Scripts

| Script          | What it does                                              |
|-----------------|-----------------------------------------------------------|
| `npm start`     | Runs the Express server using local JSON storage          |
| `npm run dev`   | Runs Express with `--watch` for auto-restart              |
| `npm run build` | No-op (echoes a message)                                  |
| `npm run pages:dev` | Runs Cloudflare Pages locally with D1 binding         |
| `npm run d1:migrate:local` | Applies D1 migrations to local Wrangler D1    |
| `npm run d1:migrate:remote` | Applies D1 migrations to Cloudflare D1       |
| `npm run pages:deploy` | Deploys the `public/` site to Cloudflare Pages     |

> **Note:** There's no real build step — the frontend is plain HTML/CSS/JS served as static files. Platforms like Render/Railway default to running `npm run build` before `npm start`; the no-op script just keeps them happy.

## 📁 Project Structure

```
match-schedule/
├── server.js              # Express app + JSON-file API routes
├── wrangler.toml          # Cloudflare Pages/D1 config
├── functions/
│   └── api/[[path]].js    # Cloudflare Pages Functions API backed by D1
├── migrations/            # D1 schema + seed data
├── package.json
├── data/
│   └── tournament.json    # Local Express seed/storage
├── public/
│   ├── index.html         # Public tournament page
│   ├── admin.html         # Admin login + score entry
│   ├── style.css          # Shared styles (dark esports theme)
│   ├── app.js             # Public page logic
│   ├── admin.js           # Admin panel logic
│   └── images/            # Player avatars (PNG)
│       ├── ay.png
│       ├── ze.png
│       ├── so.png
│       ├── as.png
│       └── ar.png
└── README.md
```

## 🔌 API

### Public

| Method | Path                | Description                              |
|--------|---------------------|------------------------------------------|
| GET    | `/api/health`       | D1/API health check for Cloudflare deploys |
| GET    | `/api/tournament`   | Full tournament data (players + matches + progress meta; knockout slots resolved after groups finish) |
| GET    | `/api/standings`    | Live standings, computed from group results |

### Admin (requires `Authorization: Bearer <token>`)

| Method | Path                       | Description                       |
|--------|----------------------------|-----------------------------------|
| POST   | `/api/auth/login`          | `{ password }` → `{ token }`     |
| POST   | `/api/auth/logout`         | Invalidate current token         |
| PUT    | `/api/matches/:id`         | Set score, mark live, reset a match, or update `date` / `time` / `gameMode` |
| POST   | `/api/reset`               | Reset all match results          |

## 🏅 Tournament Format

- **Group stage:** Round-robin — every player plays every other player **twice** (20 matches total)
- **Points:** Win = 3 · Draw = 1 · Loss = 0
- **Knockout:**
  - Knockout slots stay hidden until all 20 group-stage matches are completed
  - 1st & 2nd place → **Grand Final** (Bo3, 15 min + unlimited ET)
  - 3rd & 4th place → **Semi Final / 3rd-place match** (Bo3, 15 min + unlimited ET)
  - 5th place → eliminated
- **Group matches:** 10 min + 5 min ET
- **Game modes:** randomly selected per match

## ☁️ Deploying with Cloudflare Pages + D1

Use this option when you want the admin panel to save live scores/date-times on Cloudflare.

### 1) Login to Cloudflare

```bash
npx wrangler login
```

### 2) Create a D1 database

```bash
npx wrangler d1 create match-schedule-db
```

Wrangler prints a `database_id`. Copy that ID into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "match-schedule-db"
database_id = "paste-your-real-database-id-here"
```

### 3) Apply migrations and seed data

```bash
npm run d1:migrate:remote
```

This creates the `kv` table and inserts the initial tournament JSON into D1. The Function also auto-creates/seeds the table on first request, but running migrations is still recommended.

### 4) Set the admin password secret

Default password is `rocket2026`, but for Cloudflare you should set your own:

```bash
npx wrangler pages secret put ADMIN_PASSWORD --project-name match-schedule
```

Enter your password when prompted.

### 5) Deploy to Cloudflare Pages

```bash
npm run pages:deploy -- --project-name match-schedule
```

In Cloudflare Pages settings, make sure the D1 binding is named **`DB`** if you configure it through the dashboard.

### Local Cloudflare/D1 testing

```bash
npm run d1:migrate:local
npm run pages:dev
```

Then open the local URL Wrangler prints. This uses local D1 instead of `data/tournament.json`.

## ☁️ Other Node deployments

You can still run the Express version anywhere Node.js runs:

- **Render / Railway / Fly.io:** connect the repo, build command `npm install`, start command `npm start`
- **VPS / server:** clone → `npm install` → `npm start` behind nginx/pm2
- **Local LAN:** `npm start`, share `http://your-lan-ip:3000/` with friends

For Node/Express hosting, set `ADMIN_PASSWORD` as a secret env var in production. `PORT` is also configurable. The server no longer prints the actual admin password to logs.

## 🔒 Security Note

The admin password is intentionally simple — this is a tournament tracker for friends, not a production app. Don't expose the admin URL publicly without changing the password first.

---

Made with 🚀 for the love of the game.
