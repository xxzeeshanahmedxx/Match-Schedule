/**
 * Rocket League Championship — Tournament Tracker
 * Express backend with JSON file storage
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'rocket2026';
const DATA_FILE = path.join(__dirname, 'data', 'tournament.json');

// ─────────── Middleware ───────────
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─────────── Data helpers ───────────
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read data file:', err.message);
    return null;
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────── Auth (in-memory sessions) ───────────
const sessions = new Map(); // token → createdAt

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now());
  // prune old sessions (>24h)
  for (const [k, v] of sessions) {
    if (Date.now() - v > 24 * 60 * 60 * 1000) sessions.delete(k);
  }
  return token;
}

// ─────────── Public API ───────────

// GET /api/tournament — full tournament state
app.get('/api/tournament', (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load tournament data' });
  res.json(data);
});

// GET /api/standings — calculated from current match results
app.get('/api/standings', (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load data' });

  const stats = {};
  for (const p of data.players) {
    stats[p.id] = { id: p.id, name: p.name, image: p.image, gp: 0, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0 };
  }

  // Only count group-stage matches for standings
  for (const m of data.matches) {
    if (m.stage !== 'group' || m.status !== 'completed') continue;
    if (m.score1 == null || m.score2 == null) continue;

    const a = stats[m.player1], b = stats[m.player2];
    if (!a || !b) continue;

    a.gp++; b.gp++;
    a.gf += m.score1; a.ga += m.score2;
    b.gf += m.score2; b.ga += m.score1;

    if (m.score1 > m.score2) {
      a.w++; b.l++; a.pts += 3;
    } else if (m.score1 < m.score2) {
      b.w++; a.l++; b.pts += 3;
    } else {
      a.d++; b.d++; a.pts += 1; b.pts += 1;
    }
  }

  const ranked = Object.values(stats).sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    const xgd = x.gf - x.ga, ygd = y.gf - y.ga;
    if (ygd !== xgd) return ygd - xgd;
    return y.gf - x.gf;
  });

  res.json(ranked);
});

// ─────────── Admin auth ───────────

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  const token = createSession();
  res.json({ token });
});

app.post('/api/auth/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// ─────────── Admin: matches ───────────

// PUT /api/matches/:id — set score / status for a match
app.put('/api/matches/:id', requireAdmin, (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load data' });

  const match = data.matches.find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const { score1, score2, status } = req.body || {};

  if (status === 'reset' || (score1 === null && score2 === null && status === 'upcoming')) {
    match.score1 = null;
    match.score2 = null;
    match.status = 'upcoming';
  } else {
    if (typeof score1 === 'number' && typeof score2 === 'number' && score1 >= 0 && score2 >= 0) {
      match.score1 = score1;
      match.score2 = score2;
      match.status = 'completed';
    } else {
      return res.status(400).json({ error: 'Invalid score. Use non-negative numbers.' });
    }
    if (status && ['upcoming', 'live', 'completed'].includes(status)) {
      match.status = status;
    }
  }

  writeData(data);
  res.json(match);
});

// POST /api/reset — reset all match results (keeps schedule)
app.post('/api/reset', requireAdmin, (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load data' });
  for (const m of data.matches) {
    m.score1 = null;
    m.score2 = null;
    m.status = 'upcoming';
  }
  writeData(data);
  res.json({ ok: true });
});

// ─────────── SPA fallback ───────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────── Boot ───────────
app.listen(PORT, () => {
  console.log(`\n🏆  Rocket League Championship server running`);
  console.log(`   Public:  http://localhost:${PORT}/`);
  console.log(`   Admin:   http://localhost:${PORT}/admin`);
  console.log(`   Password: ${ADMIN_PASSWORD}  (set ADMIN_PASSWORD env var to change)\n`);
});
