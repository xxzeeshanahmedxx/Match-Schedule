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
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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

function hasScore(match) {
  return Number.isInteger(match.score1) && Number.isInteger(match.score2) && match.score1 >= 0 && match.score2 >= 0;
}

function groupMatches(data) {
  return data.matches.filter(m => m.stage === 'group');
}

function groupProgress(data) {
  const group = groupMatches(data);
  const completed = group.filter(m => m.status === 'completed' && hasScore(m)).length;
  return {
    completed,
    total: group.length,
    complete: group.length > 0 && completed === group.length
  };
}

function calculateStandings(data) {
  const stats = {};
  for (const p of data.players) {
    stats[p.id] = {
      id: p.id,
      name: p.name,
      image: p.image,
      gp: 0,
      w: 0,
      d: 0,
      l: 0,
      pts: 0,
      gf: 0,
      ga: 0,
      gd: 0
    };
  }

  // Only count completed group-stage matches for standings.
  for (const m of data.matches) {
    if (m.stage !== 'group' || m.status !== 'completed' || !hasScore(m)) continue;

    const a = stats[m.player1];
    const b = stats[m.player2];
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

  for (const s of Object.values(stats)) s.gd = s.gf - s.ga;

  return Object.values(stats).sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gd !== x.gd) return y.gd - x.gd;
    if (y.gf !== x.gf) return y.gf - x.gf;
    if (y.w !== x.w) return y.w - x.w;
    return x.name.localeCompare(y.name);
  });
}

function resolveMatchParticipants(match, standings, progress) {
  if (match.stage === 'group') return { ...match };

  const resolved = { ...match };

  // Knockout slots are ranking-based and only lock once the group stage is complete.
  if (progress.complete) {
    const p1 = standings[(match.slot1Rank || 0) - 1];
    const p2 = standings[(match.slot2Rank || 0) - 1];
    resolved.player1 = p1 ? p1.id : null;
    resolved.player2 = p2 ? p2.id : null;
  } else {
    resolved.player1 = null;
    resolved.player2 = null;
  }

  return resolved;
}

function buildTournamentPayload(data) {
  const standings = calculateStandings(data);
  const progress = groupProgress(data);

  return {
    ...data,
    matches: data.matches.map(m => resolveMatchParticipants(m, standings, progress)),
    meta: {
      ...(data.meta || {}),
      groupCompleted: progress.completed,
      groupTotal: progress.total,
      groupStageComplete: progress.complete
    }
  };
}

function resetKnockoutResults(data) {
  for (const m of data.matches) {
    if (m.stage === 'group') continue;
    m.score1 = null;
    m.score2 = null;
    m.status = 'upcoming';
  }
}

function extractBearer(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function requireAdmin(req, res, next) {
  const token = extractBearer(req);
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─────────── Auth (in-memory sessions) ───────────
const sessions = new Map(); // token → createdAt

function pruneSessions() {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (now - v > SESSION_TTL_MS) sessions.delete(k);
  }
}

function createSession() {
  pruneSessions();
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now());
  return token;
}

// ─────────── Public API ───────────

// GET /api/tournament — full tournament state with dynamic knockout slots resolved
app.get('/api/tournament', (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load tournament data' });
  res.json(buildTournamentPayload(data));
});

// GET /api/standings — calculated from current group results
app.get('/api/standings', (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load data' });
  res.json(calculateStandings(data));
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
  const token = extractBearer(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// ─────────── Admin: matches ───────────

// PUT /api/matches/:id — set score, mark live, or reset a match
app.put('/api/matches/:id', requireAdmin, (req, res) => {
  const data = readData();
  if (!data) return res.status(500).json({ error: 'Could not load data' });

  const match = data.matches.find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const { score1, score2, status } = req.body || {};
  const progress = groupProgress(data);

  if (match.stage !== 'group' && !progress.complete) {
    return res.status(409).json({ error: 'Finish all group-stage matches before editing knockout results.' });
  }

  if (status === 'reset' || (score1 === null && score2 === null && status === 'upcoming')) {
    match.score1 = null;
    match.score2 = null;
    match.status = 'upcoming';
  } else if (status === 'live') {
    match.status = 'live';
    if (score1 === null || score1 === undefined) match.score1 = null;
    if (score2 === null || score2 === undefined) match.score2 = null;
  } else {
    if (!Number.isInteger(score1) || !Number.isInteger(score2) || score1 < 0 || score2 < 0) {
      return res.status(400).json({ error: 'Invalid score. Use whole, non-negative numbers.' });
    }

    match.score1 = score1;
    match.score2 = score2;
    match.status = status && ['upcoming', 'live', 'completed'].includes(status) ? status : 'completed';
  }

  // Group results drive knockout slots. If a group match changes after knockouts
  // were entered, clear knockout scores so old results are not attached to new seeds.
  if (match.stage === 'group') resetKnockoutResults(data);

  writeData(data);

  const standings = calculateStandings(data);
  const nextProgress = groupProgress(data);
  res.json(resolveMatchParticipants(match, standings, nextProgress));
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
  console.log(`   Admin password: ${process.env.ADMIN_PASSWORD ? 'custom env var set' : 'using default (set ADMIN_PASSWORD env var to change)'}\n`);
});
