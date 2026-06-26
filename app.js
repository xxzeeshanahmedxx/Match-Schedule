/* ──────────────────────────────────────────────
   Rocket League Championship — public page
   ────────────────────────────────────────────── */

const ICONS = ['!', '⏱', '+', '★', '↑', '∞', '◉', '⚄'];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let DATA = null;
let STANDINGS = [];
let USING_STATIC_DATA = false;

const pathParts = window.location.pathname.split('/').filter(Boolean);
const repoBase = pathParts.length ? `/${pathParts[0]}` : '';
const IMAGE_BASES = [...new Set([
  'images/',
  'public/images/',
  './images/',
  './public/images/',
  '/images/',
  '/public/images/',
  repoBase ? `${repoBase}/images/` : null,
  repoBase ? `${repoBase}/public/images/` : null
].filter(Boolean))];

function optimizedImageFile(path) {
  return path.replace(/\.png$/i, '.webp');
}

function img(path) {
  // Prefer tiny WebP avatars for speed; if unavailable, the global image error
  // handler falls back to the original PNG stored in data-image-file.
  return `${IMAGE_BASES[0]}${optimizedImageFile(path)}`;
}

function installImageFallbacks() {
  document.addEventListener('error', event => {
    const el = event.target;
    if (!(el instanceof HTMLImageElement)) return;

    const originalFile = el.dataset.imageFile || (el.getAttribute('src') || '').split('/').pop();
    if (!originalFile) return;

    const optimizedFile = optimizedImageFile(originalFile);
    const candidates = [
      ...IMAGE_BASES.map(base => `${base}${optimizedFile}`),
      ...IMAGE_BASES.map(base => `${base}${originalFile}`)
    ];
    const nextIndex = Number(el.dataset.fallbackIndex || 0) + 1;

    if (nextIndex >= candidates.length) {
      el.style.display = 'none';
      const holder = el.closest('.player-logo, .team-logo, .mini-logo, .featured-avatar');
      if (holder && !holder.dataset.fallbackText) {
        holder.dataset.fallbackText = (el.alt || '?').slice(0, 2).toUpperCase();
        holder.textContent = holder.dataset.fallbackText;
      }
      return;
    }

    el.dataset.imageFile = originalFile;
    el.dataset.fallbackIndex = String(nextIndex);
    el.src = candidates[nextIndex];
  }, true);
}

installImageFallbacks();

function playerById(id) {
  return DATA.players.find(p => p.id === id) || null;
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function isGroupComplete() {
  return Boolean(DATA?.meta?.groupStageComplete);
}

function stageName(stage) {
  if (stage === 'final') return 'Grand Final';
  if (stage === 'semifinal') return 'Semi Final';
  return stage;
}

function statusLabel(status) {
  if (status === 'live') return 'Live';
  if (status === 'completed') return 'Final';
  return 'Upcoming';
}

function formatGameMode(match) {
  return match.gameMode || 'Mode TBD';
}

function formatMatchDateTime(match) {
  if (!match.date && !match.time) return 'Date/time TBD';

  if (match.date && match.time) {
    const d = new Date(`${match.date}T${match.time}`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
  }

  if (match.date) return formatDate(match.date);
  return `Time: ${match.time}`;
}

function hasScore(match) {
  return Number.isInteger(match.score1) && Number.isInteger(match.score2) && match.score1 >= 0 && match.score2 >= 0;
}

function calculateStandings(data) {
  const stats = {};
  for (const p of data.players) {
    stats[p.id] = { id: p.id, name: p.name, image: p.image, gp: 0, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, gd: 0 };
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

function groupProgress(data) {
  const group = data.matches.filter(m => m.stage === 'group');
  const completed = group.filter(m => m.status === 'completed' && hasScore(m)).length;
  return { completed, total: group.length, complete: group.length > 0 && completed === group.length };
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
  if (winnerOf) return getMatchWinnerId(data.matches.find(item => item.id === winnerOf), standings, progress, data);
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

function normalizeTournamentData(rawData, standings = null) {
  const data = JSON.parse(JSON.stringify(rawData));
  const ranked = standings || calculateStandings(data);
  const progress = groupProgress(data);

  data.matches = data.matches.map(match => resolveMatchParticipants(match, ranked, progress, data));

  data.meta = {
    ...(data.meta || {}),
    groupCompleted: progress.completed,
    groupTotal: progress.total,
    groupStageComplete: progress.complete
  };

  return data;
}

async function fetchJsonCandidates(paths) {
  let lastError = null;
  for (const path of paths) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No data source found');
}

async function loadFromApi() {
  // One request is enough: standings are deterministic from tournament data.
  // This cuts API/D1 work in half on first load and every auto-refresh.
  const tRes = await fetch('/api/tournament', { cache: 'no-store' });
  if (!tRes.ok) throw new Error('API error');
  const tournament = await tRes.json();
  const standings = calculateStandings(tournament);
  USING_STATIC_DATA = false;
  DATA = normalizeTournamentData(tournament, standings);
  STANDINGS = standings;
}

async function loadFromStaticJson() {
  const candidates = [...new Set([
    'data/tournament.json',
    './data/tournament.json',
    '../data/tournament.json',
    'public/data/tournament.json',
    './public/data/tournament.json',
    '../public/data/tournament.json',
    '/data/tournament.json',
    '/public/data/tournament.json',
    repoBase ? `${repoBase}/data/tournament.json` : null,
    repoBase ? `${repoBase}/public/data/tournament.json` : null
  ].filter(Boolean))];

  const tournament = await fetchJsonCandidates(candidates);
  USING_STATIC_DATA = true;
  STANDINGS = calculateStandings(tournament);
  DATA = normalizeTournamentData(tournament, STANDINGS);
}

async function loadTournamentData() {
  try {
    await loadFromApi();
  } catch (apiError) {
    console.warn('API unavailable; falling back to static tournament JSON.', apiError);
    await loadFromStaticJson();
  }
}

// ───── Render functions ─────

function renderHeader() {
  const totalMatches = DATA.matches.length;
  const groupCompleted = DATA.meta?.groupCompleted ?? 0;
  const groupTotal = DATA.meta?.groupTotal ?? DATA.matches.filter(m => m.stage === 'group').length;

  $('#badge-text').textContent = DATA.tournament.subtitle;
  $('#subtitle').textContent = `${DATA.players.length} Players · ${totalMatches} Matches · 1 Champion`;
  $('#foot-name').textContent = DATA.tournament.name;
  $('#foot-date').textContent = formatDate(DATA.tournament.startDate);

  const totalModes = DATA.gameModes?.length || 0;
  const meta = [
    { label: 'Start Date', value: formatDate(DATA.tournament.startDate) },
    { label: 'Group Progress', value: `${groupCompleted}/${groupTotal} Played` },
    { label: 'Game Modes', value: `${totalModes} Available` },
    { label: 'Format', value: DATA.tournament.format }
  ];
  $('#meta-row').innerHTML = meta.map(m => `
    <div class="meta-chip">
      <span class="label">${m.label}</span>
      <strong>${m.value}</strong>
    </div>
  `).join('');

  const pct = groupTotal ? Math.round((groupCompleted / groupTotal) * 100) : 0;
  $('#progress-label').textContent = `${groupCompleted}/${groupTotal} · ${pct}%`;
  $('#progress-fill').style.width = `${pct}%`;
}

function renderPlayers() {
  $('#players-grid').innerHTML = DATA.players.map(p => `
    <div class="player-card">
      <div class="player-logo"><img src="${img(p.image)}" alt="${p.name}" data-image-file="${p.image}" loading="lazy" decoding="async" /></div>
      <div class="player-name">${p.name}</div>
    </div>
  `).join('');
}

function renderMatchCard(m, numLabel) {
  const p1 = playerById(m.player1);
  const p2 = playerById(m.player2);
  const s1 = m.score1, s2 = m.score2;
  const done = m.status === 'completed' && s1 != null && s2 != null;

  let score1Class = '', score2Class = '', score1Text = '—', score2Text = '—';
  if (done) {
    score1Text = s1;
    score2Text = s2;
    if (s1 > s2) { score1Class = 'is-winner'; score2Class = 'is-loser'; }
    else if (s2 > s1) { score2Class = 'is-winner'; score1Class = 'is-loser'; }
  }

  const matchClass = m.status === 'live' ? 'is-live' : (done ? 'is-completed' : '');

  return `
    <div class="match ${matchClass}">
      <div class="match-num">${numLabel}</div>
      <div class="match-body">
        <div class="team">
          <div class="team-logo"><img src="${img(p1.image)}" alt="${p1.name}" data-image-file="${p1.image}" loading="lazy" decoding="async" /></div>
          <div class="team-name">${p1.name}</div>
          <div class="team-score ${score1Class}">${score1Text}</div>
        </div>
        <div class="vs">VS</div>
        <div class="team">
          <div class="team-logo"><img src="${img(p2.image)}" alt="${p2.name}" data-image-file="${p2.image}" loading="lazy" decoding="async" /></div>
          <div class="team-name">${p2.name}</div>
          <div class="team-score ${score2Class}">${score2Text}</div>
        </div>
      </div>
      <div class="match-details">
        <span>📅 ${formatMatchDateTime(m)}</span>
        <span>🎮 ${formatGameMode(m)}</span>
      </div>
      <div class="match-foot">
        <span>Group</span>
        <span class="status ${m.status}">${statusLabel(m.status)}</span>
      </div>
    </div>
  `;
}

function renderSchedule() {
  const matches = DATA.matches.filter(m => m.stage === 'group').sort((a, b) => a.order - b.order);
  $('#schedule').innerHTML = matches.map((m, i) => {
    const label = 'M' + String(i + 1).padStart(2, '0');
    return renderMatchCard(m, label);
  }).join('');
}

function renderStandings() {
  if (!STANDINGS.length) {
    $('#standings-body').innerHTML = '<tr><td colspan="10" style="text-align:center; color: var(--muted); padding: 32px;">No standings available yet</td></tr>';
    return;
  }

  $('#standings-body').innerHTML = STANDINGS.map((s, i) => {
    const rankClass = i === 0 ? 'rank-1' : (i === 1 ? 'rank-2' : (i === 2 ? 'rank-3' : ''));
    const gdClass = s.gd > 0 ? 'good' : (s.gd < 0 ? 'bad' : '');
    return `
      <tr>
        <td><span class="rank ${rankClass}">${i + 1}</span></td>
        <td>
          <div class="standings-player">
            <div class="mini-logo"><img src="${img(s.image)}" alt="${s.name}" data-image-file="${s.image}" loading="lazy" decoding="async" /></div>
            <div>
              <strong>${s.name}</strong>
              <span class="mobile-stat-line">GP ${s.gp} · ${s.w}-${s.d}-${s.l} · GF ${s.gf} GA ${s.ga} · GD ${s.gd > 0 ? '+' : ''}${s.gd}</span>
            </div>
          </div>
        </td>
        <td>${s.gp}</td>
        <td>${s.w}</td>
        <td>${s.d}</td>
        <td>${s.l}</td>
        <td>${s.gf}</td>
        <td>${s.ga}</td>
        <td><span class="gd ${gdClass}">${s.gd > 0 ? '+' : ''}${s.gd}</span></td>
        <td><span class="pts">${s.pts}</span></td>
      </tr>
    `;
  }).join('');
}

function renderKnockoutSlot(match, side) {
  const isFirst = side === 1;
  const player = playerById(isFirst ? match.player1 : match.player2);
  const rank = isFirst ? match.slot1Rank : match.slot2Rank;
  const slotLabel = isFirst ? match.slot1Label : match.slot2Label;
  const score = isFirst ? match.score1 : match.score2;
  const oppScore = isFirst ? match.score2 : match.score1;
  const done = match.status === 'completed' && score != null && oppScore != null;
  const resultClass = done && score > oppScore ? 'is-winner' : (done && score < oppScore ? 'is-loser' : '');

  if (!player) {
    return `
      <div class="tbd-slot">
        <span style="font-family: inherit;">${slotLabel || (rank ? ordinal(rank) + ' Place' : 'TBD')}</span>
        <span class="slot-score">—</span>
      </div>
    `;
  }

  return `
    <div class="tbd-slot is-filled ${resultClass}">
      <div class="team-logo"><img src="${img(player.image)}" alt="${player.name}" data-image-file="${player.image}" loading="lazy" decoding="async" /></div>
      <span class="team-name">${player.name}</span>
      <span class="slot-score">${done ? score : '—'}</span>
    </div>
  `;
}

function renderKnockoutStage(match) {
  const done = match.status === 'completed' && match.score1 != null && match.score2 != null;
  const isFinal = match.stage === 'final';
  const p1 = playerById(match.player1);
  const p2 = playerById(match.player2);
  const winner = done ? (match.score1 > match.score2 ? p1 : (match.score2 > match.score1 ? p2 : null)) : null;

  return `
    <div class="knockout-stage ${isFinal ? 'final-stage' : ''}">
      <div class="stage-label">${isFinal ? 'Grand Final' : (match.label || 'Semi Final')}</div>
      <div class="stage-title">${isFinal ? '🏆 ' : ''}${stageName(match.stage).toUpperCase()}</div>
      <div class="stage-desc">${match.series || 'Best of 3'} · ${match.minutes || DATA.tournament.knockoutMinutes} min + ${match.extraTime || DATA.tournament.knockoutExtraTime} ET</div>
      <div class="stage-time">📅 ${formatMatchDateTime(match)} · 🎮 ${formatGameMode(match)}</div>
      ${renderKnockoutSlot(match, 1)}
      <div class="knockout-versus">⚔</div>
      ${renderKnockoutSlot(match, 2)}
      <div class="match-foot knockout-foot">
        <span>${match.player1 && match.player2 ? 'Slots locked' : (isFinal ? 'Winners of semi finals' : 'Revealed after group stage')}</span>
        <span class="status ${match.status}">${statusLabel(match.status)}</span>
      </div>
      ${winner && isFinal ? `<div class="champion-banner">Champion: ${winner.name}</div>` : ''}
    </div>
  `;
}

function renderKnockout() {
  const matches = DATA.matches.filter(m => m.stage !== 'group').sort((a, b) => a.order - b.order);
  if (!matches.length) {
    $('#knockout').innerHTML = '<div class="empty-note">Knockout matches have not been scheduled yet.</div>';
    return;
  }

  const semiFinals = matches.filter(m => m.stage === 'semifinal');
  const final = matches.find(m => m.stage === 'final');
  $('#knockout').innerHTML = `
    <div class="knockout-column semi-column">
      ${semiFinals.map(renderKnockoutStage).join('')}
    </div>
    <div class="connector">→</div>
    <div class="knockout-column final-column">
      ${final ? renderKnockoutStage(final) : '<div class="empty-note">Final not scheduled yet.</div>'}
    </div>
  `;
}

function renderRules() {
  $('#rules-grid').innerHTML = DATA.rules.map((r, i) => `
    <div class="rule">
      <div class="icon">${ICONS[i] || '•'}</div>
      <div>
        <div class="rule-title">${r.title}</div>
        <div class="rule-text">${r.text}</div>
      </div>
    </div>
  `).join('');
}

function matchSortValue(match) {
  if (match.date && match.time) return new Date(`${match.date}T${match.time}`).getTime();
  if (match.date) return new Date(`${match.date}T00:00:00`).getTime();
  return Number.MAX_SAFE_INTEGER - (1000 - (match.order || 0));
}

function getFeaturedMatch() {
  const live = DATA.matches.find(m => m.status === 'live');
  if (live) return live;
  return DATA.matches
    .filter(m => m.status !== 'completed')
    .slice()
    .sort((a, b) => matchSortValue(a) - matchSortValue(b) || (a.order || 0) - (b.order || 0))[0] || null;
}

function renderFeaturedTeam(player, rank, fallbackLabel = 'TBD') {
  if (!player) return `<div class="featured-team"><div class="featured-avatar">?</div><strong>${fallbackLabel || (rank ? ordinal(rank) + ' Place' : 'TBD')}</strong></div>`;
  return `
    <div class="featured-team">
      <div class="featured-avatar"><img src="${img(player.image)}" alt="${player.name}" data-image-file="${player.image}" loading="lazy" decoding="async" /></div>
      <strong>${player.name}</strong>
    </div>
  `;
}

function renderNextUp() {
  const match = getFeaturedMatch();
  const section = $('#next-up-section');
  if (!match) {
    section.hidden = true;
    return;
  }

  const p1 = playerById(match.player1);
  const p2 = playerById(match.player2);
  const stage = match.stage === 'group' ? 'Group Stage' : stageName(match.stage);
  section.hidden = false;
  $('#next-up').innerHTML = `
    <div class="next-card ${match.status === 'live' ? 'is-live' : ''}">
      <div class="next-meta">
        <span class="status ${match.status}">${statusLabel(match.status)}</span>
        <span>${stage} · ${match.label || 'Match ' + String(match.order || '').padStart(2, '0')}</span>
      </div>
      <div class="next-teams">
        ${renderFeaturedTeam(p1, match.slot1Rank, match.slot1Label)}
        <div class="next-vs">VS</div>
        ${renderFeaturedTeam(p2, match.slot2Rank, match.slot2Label)}
      </div>
      <div class="next-time">📅 ${formatMatchDateTime(match)} · 🎮 ${formatGameMode(match)}</div>
    </div>
  `;
}

function renderStaticNotice() {
  const existing = $('#static-data-note');
  if (!USING_STATIC_DATA) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;
  document.body.insertAdjacentHTML('beforeend',
    `<div id="static-data-note" style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#14141f;color:#e8e8f0;border:1px solid rgba(255,255,255,.12);padding:10px 16px;border-radius:999px;z-index:9999;font-size:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);">Static preview mode: live admin/API updates are unavailable here.</div>`
  );
  setTimeout(() => $('#static-data-note')?.remove(), 7000);
}

function renderAll() {
  document.title = `${DATA.tournament.name} · 2026`;
  renderHeader();
  renderPlayers();
  renderNextUp();
  renderStandings();
  renderSchedule();
  renderKnockout();
  renderRules();
  renderStaticNotice();
}

// ───── Fetch + bootstrap ─────

async function loadAll() {
  try {
    await loadTournamentData();
    renderAll();
  } catch (err) {
    console.error('Failed to load:', err);
    document.body.insertAdjacentHTML('beforeend',
      `<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#ff5577;color:white;padding:12px 20px;border-radius:8px;z-index:9999;">Failed to load tournament data. Refresh to try again.</div>`
    );
  }
}

loadAll();

// Auto-refresh every 30s so scores stay fresh on the Express app. Static hosting
// has no API, so the first static JSON render is enough.
setInterval(async () => {
  if (USING_STATIC_DATA) return;
  try {
    await loadFromApi();
    if (DATA) {
      renderHeader();
      renderNextUp();
      renderStandings();
      renderSchedule();
      renderKnockout();
    }
  } catch (_) {}
}, 30000);
