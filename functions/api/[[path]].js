import INITIAL_TOURNAMENT from './seed.js';

/**
 * Cloudflare Pages Functions API backed by D1.
 *
 * D1 stores the tournament as JSON in a small kv table. This keeps the existing
 * app logic simple while moving persistence from a local JSON file to Cloudflare.
 */

const TOURNAMENT_KEY = 'tournament';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GAME_MODES = INITIAL_TOURNAMENT.gameModes || [];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch (_) {
    return {};
  }
}

let schemaReady = false;

function requireDB(env) {
  if (!env.DB) throw new Error('D1 binding missing. Add a D1 binding named DB in Cloudflare Pages settings.');
  return env.DB;
}

async function ensureSchema(env) {
  const db = requireDB(env);
  if (schemaReady) return db;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  schemaReady = true;
  return db;
}

async function getKV(env, key) {
  const db = await ensureSchema(env);
  const row = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

async function putKV(env, key, value) {
  const db = await ensureSchema(env);
  await db.prepare(`
    INSERT INTO kv (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).bind(key, JSON.stringify(value)).run();
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
  if (progress.complete) {
    resolved.player1 = standings[(match.slot1Rank || 0) - 1]?.id || null;
    resolved.player2 = standings[(match.slot2Rank || 0) - 1]?.id || null;
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
  const modes = data.gameModes || [];
  if (!modes.includes(value)) throw new Error('Invalid game mode. Choose one of the allowed Rocket League modes.');
  return value;
}

function applyMatchMetaFields(match, body, data) {
  if (hasOwn(body, 'date')) match.date = normalizeDate(body.date);
  if (hasOwn(body, 'time')) match.time = normalizeTime(body.time);
  if (hasOwn(body, 'gameMode')) match.gameMode = normalizeGameMode(body.gameMode, data);
}

function extractBearer(request) {
  return (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

function createNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function sessionSecret(env) {
  return `match-schedule-admin:${env.ADMIN_PASSWORD || 'rocket2026'}`;
}

async function signText(text, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  let binary = '';
  for (const b of new Uint8Array(signature)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createSession(env) {
  // Stateless signed token. This avoids a common failure mode where the correct
  // password succeeds but login still fails because D1 session writes are not yet
  // configured. Match data still uses D1; auth tokens are verified by signature.
  const now = Date.now();
  const payload = {
    iat: now,
    exp: now + SESSION_TTL_MS,
    nonce: createNonce()
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await signText(encodedPayload, sessionSecret(env));
  return `${encodedPayload}.${signature}`;
}

async function requireAdmin(request, env) {
  const token = extractBearer(request);
  if (!token) return false;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;

  const expected = await signText(encodedPayload, sessionSecret(env));
  if (signature !== expected) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    return Number.isFinite(payload.exp) && payload.exp > Date.now();
  } catch (_) {
    return false;
  }
}

function ensureTournamentShape(data) {
  let changed = false;
  if (!Array.isArray(data.gameModes) || data.gameModes.length === 0) {
    data.gameModes = DEFAULT_GAME_MODES;
    changed = true;
  }
  for (const match of data.matches || []) {
    if (!hasOwn(match, 'gameMode')) {
      match.gameMode = null;
      changed = true;
    }
  }
  return changed;
}

async function getTournament(env) {
  let data = await getKV(env, TOURNAMENT_KEY);
  if (!data) {
    // Auto-seed the database on first request so a fresh D1 binding can start
    // working even before the user manually runs migrations.
    data = JSON.parse(JSON.stringify(INITIAL_TOURNAMENT));
    await putKV(env, TOURNAMENT_KEY, data);
  } else if (ensureTournamentShape(data)) {
    await putKV(env, TOURNAMENT_KEY, data);
  }
  return data;
}

async function handleHealth(env) {
  try {
    await ensureSchema(env);
    const tournament = await getTournament(env);
    return json({
      ok: true,
      dbBinding: 'DB',
      tournamentLoaded: Boolean(tournament),
      matches: tournament?.matches?.length || 0
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

async function handleGetTournament(env) {
  const data = await getTournament(env);
  if (!data) return json({ error: 'Tournament data not found. Run the D1 migrations/seed first.' }, 500);
  return json(buildTournamentPayload(data));
}

async function handleGetStandings(env) {
  const data = await getTournament(env);
  if (!data) return json({ error: 'Tournament data not found. Run the D1 migrations/seed first.' }, 500);
  return json(calculateStandings(data));
}

async function handleLogin(request, env) {
  const { password } = await readBody(request);
  const adminPassword = env.ADMIN_PASSWORD || 'rocket2026';
  if (!password || password !== adminPassword) {
    return json({ error: 'Wrong password' }, 401);
  }
  const token = await createSession(env);
  return json({ token });
}

async function handleLogout(request, env) {
  return json({ ok: true });
}

async function handleUpdateMatch(request, env, matchId) {
  if (!(await requireAdmin(request, env))) return json({ error: 'Unauthorized' }, 401);

  const data = await getTournament(env);
  if (!data) return json({ error: 'Tournament data not found. Run the D1 migrations/seed first.' }, 500);

  const match = data.matches.find(m => m.id === matchId);
  if (!match) return json({ error: 'Match not found' }, 404);

  const body = await readBody(request);
  const { score1, score2, status } = body;
  const progress = groupProgress(data);
  const hasMetaUpdate = hasOwn(body, 'date') || hasOwn(body, 'time') || hasOwn(body, 'gameMode');
  const hasResultOrStatusUpdate = hasOwn(body, 'score1') || hasOwn(body, 'score2') || hasOwn(body, 'status');

  if (match.stage !== 'group' && !progress.complete && hasResultOrStatusUpdate) {
    return json({ error: 'Finish all group-stage matches before editing knockout results.' }, 409);
  }

  try {
    if (hasMetaUpdate) applyMatchMetaFields(match, body, data);
  } catch (err) {
    return json({ error: err.message }, 400);
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
        return json({ error: 'Invalid score. Use whole, non-negative numbers.' }, 400);
      }

      match.score1 = score1;
      match.score2 = score2;
      match.status = status && ['upcoming', 'live', 'completed'].includes(status) ? status : 'completed';
    }

    if (match.stage === 'group') resetKnockoutResults(data);
  }

  if (!hasMetaUpdate && !hasResultOrStatusUpdate) {
    return json({ error: 'No match updates provided.' }, 400);
  }

  await putKV(env, TOURNAMENT_KEY, data);

  const standings = calculateStandings(data);
  const nextProgress = groupProgress(data);
  return json(resolveMatchParticipants(match, standings, nextProgress));
}

async function handleReset(request, env) {
  if (!(await requireAdmin(request, env))) return json({ error: 'Unauthorized' }, 401);

  const data = await getTournament(env);
  if (!data) return json({ error: 'Tournament data not found. Run the D1 migrations/seed first.' }, 500);

  for (const m of data.matches) {
    m.score1 = null;
    m.score2 = null;
    m.status = 'upcoming';
  }

  await putKV(env, TOURNAMENT_KEY, data);
  return json({ ok: true });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+/g, '/');
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    if (method === 'GET' && path === '/api/health') return handleHealth(env);
    if (method === 'GET' && path === '/api/tournament') return handleGetTournament(env);
    if (method === 'GET' && path === '/api/standings') return handleGetStandings(env);
    if (method === 'POST' && path === '/api/auth/login') return handleLogin(request, env);
    if (method === 'POST' && path === '/api/auth/logout') return handleLogout(request, env);
    if (method === 'POST' && path === '/api/reset') return handleReset(request, env);

    const match = path.match(/^\/api\/matches\/([^/]+)$/);
    if (method === 'PUT' && match) return handleUpdateMatch(request, env, decodeURIComponent(match[1]));

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    return json({ error: err.message || 'Server error' }, 500);
  }
}
