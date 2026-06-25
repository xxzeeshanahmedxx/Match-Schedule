# 🏆 Rocket League Championship — Tournament Tracker

A full-stack tournament tracker for the **Rocket League Championship** with 5 players, 20 group-stage matches, a semi-final/3rd-place match, and a grand final.

## ✨ Features

- 🎮 **Public page** — players, live standings, full match schedule, knockout bracket
- 🛠 **Admin panel** — password-protected score entry for every match
- 📊 **Auto-calculated standings** — sorted by points → goal difference → goals scored → wins
- 🏆 **Dynamic knockout** — top 2 advance to Final, 3rd & 4th to Semi Final/3rd-place match (locks after group stage)
- 🔴 **Live match states** — admin can mark matches live, complete, or reset
- 🗓 **Match scheduling** — admin can add or edit each match date and kickoff time
- 📱 **Fully responsive** — works on phones, tablets, desktops
- 💾 **Persistent storage** — results survive restarts (JSON file)
- 🔄 **Auto-refresh** — public page polls every 30 s for live updates

## 🛠 Tech Stack

- **Backend:** Node.js + Express (single file API/server)
- **Storage:** JSON file (`data/tournament.json`) — no database setup needed
- **Frontend:** Vanilla HTML + CSS + JavaScript — no build step
- **Auth:** Simple bearer-token admin session (in-memory)

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
| `npm start`     | Runs the Express server (production)                      |
| `npm run dev`   | Runs with `--watch` for auto-restart on file changes      |
| `npm run build` | No-op (echoes a message) — satisfies platforms that auto-run it before deploy |

> **Note:** There's no real build step — the frontend is plain HTML/CSS/JS served as static files. Platforms like Render/Railway default to running `npm run build` before `npm start`; the no-op script just keeps them happy.

## 📁 Project Structure

```
match-schedule/
├── server.js              # Express app + API routes
├── package.json
├── data/
│   └── tournament.json    # Players, matches, results (persistent)
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
| GET    | `/api/tournament`   | Full tournament data (players + matches + progress meta; knockout slots resolved after groups finish) |
| GET    | `/api/standings`    | Live standings, computed from group results |

### Admin (requires `Authorization: Bearer <token>`)

| Method | Path                       | Description                       |
|--------|----------------------------|-----------------------------------|
| POST   | `/api/auth/login`          | `{ password }` → `{ token }`     |
| POST   | `/api/auth/logout`         | Invalidate current token         |
| PUT    | `/api/matches/:id`         | Set score, mark live, reset a match, or update `date` / `time` |
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

## ☁️ Deploying

This app is tiny — it can run anywhere Node.js runs. A few zero-config options:

- **Render / Railway / Fly.io:** connect the repo, build command `npm install`, start command `npm start`
- **VPS / server:** clone → `npm install` → `npm start` behind nginx/pm2
- **Local LAN:** `npm start`, share `http://your-lan-ip:3000/` with friends

Set `ADMIN_PASSWORD` as a secret env var in production. `PORT` is also configurable. The server no longer prints the actual admin password to logs.

## 🔒 Security Note

The admin password is intentionally simple — this is a tournament tracker for friends, not a production app. Don't expose the admin URL publicly without changing the password first.

---

Made with 🚀 for the love of the game.
