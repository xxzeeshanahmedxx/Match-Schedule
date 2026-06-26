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
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────── Middleware ───────────
app.use(express.json({ limit: '64kb' }));
const staticOptions = {
  etag: true,
  maxAge: '1d',
  setHeaders(res, filePath) {
    if (/\.(html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
};
app.use(express.static(PUBLIC_DIR, staticOptions));
// Also expose public assets under common static-preview prefixes so images/CSS
// still load if the app is opened from /public/ or /Match-Schedule/.
app.use('/public', express.static(PUBLIC_DIR, staticOptions));
app.use('/Match-Schedule', express.static(PUBLIC_DIR, staticOptions));
app.use('/Match-Schedule/public', express.static(PUBLIC_DIR, staticOptions));

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

const AUTO_LIVE_LEAD_MS = 10 * 60 * 1000;

function scheduledAtMs(match) {
  if (!match?.date || !match?.time) return null;
  const value = new Date(`${match.date}T${match.time}:00+05:00`).getTime();
  return Number.isNaN(value) ? null : value;
}

function getMatchLabel(match) {
  return match.label || `Match ${String(match.order || '').padStart(2, '0')}`;
}

function getEffectiveStatus(match, now = Date.now()) {
  if (!match) return 'upcoming';
  if (match.status === 'completed' || match.status === 'live') return match.status;
  const startsAt = scheduledAtMs(match);
  if (startsAt != null && now >= startsAt - AUTO_LIVE_LEAD_MS) return 'live';
  return match.status || 'upcoming';
}

function validateChronologicalSchedule(data) {
  const scheduled = (data.matches || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(match => ({ match, startsAt: scheduledAtMs(match) }))
    .filter(item => item.startsAt != null);

  let previous = null;
  for (const item of scheduled) {
    if (previous && item.startsAt < previous.startsAt) {
      return `${getMatchLabel(item.match)} cannot be scheduled before ${getMatchLabel(previous.match)}.`;
    }
    previous = item;
  }
  return '';
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

function getMatchWinnerId(match, standings, progress, data) {
  if (!match || match.status !== 'completed' || !hasScore(match) || match.score1 === match.score2) return null;
  const resolved = resolveMatchParticipants(match, standings, progress, data);
  if (!resolved.player1 || !resolved.player2) return null;
  return match.score1 > match.score2 ? resolved.player1 : resolved.player2;
}

function resolveSlot(match, side, standings, progress, data) {
  const directPlayer = match[`player${side}`];
  if (match.stage === 'group' || directPlayer) return directPlayer || null;
  if (!progress.complete) return null;

  const rank = match[`slot${side}Rank`];
  if (rank) return standings[rank - 1]?.id || null;

  const winnerOf = match[`slot${side}WinnerOf`];
  if (winnerOf) {
    const source = data.matches.find(item => item.id === winnerOf);
    return getMatchWinnerId(source, standings, progress, data);
  }

  return null;
}

function resolveMatchParticipants(match, standings, progress, data) {
  if (match.stage === 'group') return { ...match };

  return {
    ...match,
    player1: resolveSlot(match, 1, standings, progress, data),
    player2: resolveSlot(match, 2, standings, progress, data)
  };
}

function hasResolvedParticipants(match, data) {
  if (match.stage === 'group') return true;
  const standings = calculateStandings(data);
  const progress = groupProgress(data);
  const resolved = resolveMatchParticipants(match, standings, progress, data);
  return Boolean(resolved.player1 && resolved.player2);
}

function buildTournamentPayload(data) {
  const standings = calculateStandings(data);
  const progress = groupProgress(data);

  return {
    ...data,
    matches: data.matches.map(m => {
      const resolved = resolveMatchParticipants(m, standings, progress, data);
      return { ...resolved, status: getEffectiveStatus(resolved) };
    }),
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

function resetFinalResults(data) {
  for (const m of data.matches) {
    if (m.stage !== 'final') continue;
    m.score1 = null;
    m.score2 = null;
    m.status = 'upcoming';
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeDate(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Invalid date. Use YYYY-MM-DD.');
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid calendar date.');
  }
  return value;
}

function normalizeTime(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('Invalid time. Use HH:MM in 24-hour format.');
  }
  return value;
}

function normalizeGameMode(value, data) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Invalid game mode.');
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  if (cleaned.length > 48) throw new Error('Game mode must be 48 characters or less.');
  return cleaned;
}

function applyMatchMetaFields(match, body, data) {
  if (hasOwn(body, 'date')) match.date = normalizeDate(body.date);
  if (hasOwn(body, 'time')) match.time = normalizeTime(body.time);
  if (hasOwn(body, 'gameMode')) match.gameMode = normalizeGameMode(body.gameMode, data);
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

// GET /api/health — basic API/storage health check
app.get('/api/health', (req, res) => {
  const data = readData();
  res.status(data ? 200 : 500).json({
    ok: Boolean(data),
    storage: 'json-file',
    matches: data?.matches?.length || 0
  });
});

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

  const body = req.body || {};
  const { score1, score2, status } = body;
  const progress = groupProgress(data);
  const hasMetaUpdate = hasOwn(body, 'date') || hasOwn(body, 'time') || hasOwn(body, 'gameMode');
  const hasResultOrStatusUpdate = hasOwn(body, 'score1') || hasOwn(body, 'score2') || hasOwn(body, 'status');

  // Knockout results are locked until both participants are resolved.
  // Semi finals resolve from group standings; final resolves from semi-final winners.
  if (match.stage !== 'group' && hasResultOrStatusUpdate && !hasResolvedParticipants(match, data)) {
    const message = match.stage === 'final'
      ? 'Finish both semi finals before editing the final result.'
      : 'Finish all group-stage matches before editing semi-final results.';
    return res.status(409).json({ error: message });
  }

  try {
    if (hasMetaUpdate) applyMatchMetaFields(match, body, data);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (hasMetaUpdate) {
    const scheduleError = validateChronologicalSchedule(data);
    if (scheduleError) return res.status(400).json({ error: scheduleError });
  }

  if (hasResultOrStatusUpdate) {
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

    // Earlier bracket results drive later slots. Clear dependent results when needed
    // so stale finalists/champions are not attached to new seeds.
    if (match.stage === 'group') resetKnockoutResults(data);
    if (match.stage === 'semifinal') resetFinalResults(data);
  }

  if (!hasMetaUpdate && !hasResultOrStatusUpdate) {
    return res.status(400).json({ error: 'No match updates provided.' });
  }

  writeData(data);

  const standings = calculateStandings(data);
  const nextProgress = groupProgress(data);
  {
    const resolved = resolveMatchParticipants(match, standings, nextProgress, data);
    res.json({ ...resolved, status: getEffectiveStatus(resolved) });
  }
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
app.get('/admin/', (req, res) => {
  res.redirect(301, '/admin');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ─────────── Boot ───────────
app.listen(PORT, () => {
  console.log(`\n🏆  Rocket League Championship server running`);
  console.log(`   Public:  http://localhost:${PORT}/`);
  console.log(`   Admin:   http://localhost:${PORT}/admin`);
  console.log(`   Admin password: ${process.env.ADMIN_PASSWORD ? 'custom env var set' : 'using default (set ADMIN_PASSWORD env var to change)'}\n`);
});
