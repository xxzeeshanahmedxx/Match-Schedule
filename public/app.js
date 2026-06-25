/* ──────────────────────────────────────────────
   Rocket League Championship — public page
   ────────────────────────────────────────────── */

const ICONS = ['!', '⏱', '+', '★', '↑', '∞', '◉', '⚄'];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let DATA = null;
let STANDINGS = [];

function img(path) {
  return `/images/${path}`;
}

function playerById(id) {
  return DATA.players.find(p => p.id === id);
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ───── Render functions ─────

function renderHeader() {
  $('#badge-text').textContent = DATA.tournament.subtitle;
  $('#subtitle').textContent = `${DATA.players.length} Players · ${DATA.matches.length + 2} Matches · 1 Champion`;
  $('#foot-name').textContent = DATA.tournament.name;
  $('#foot-date').textContent = formatDate(DATA.tournament.startDate);

  const meta = [
    { label: 'Start Date', value: formatDate(DATA.tournament.startDate) },
    { label: 'Format', value: DATA.tournament.format },
    { label: 'Game Modes', value: 'Random Selection' },
    { label: 'Stream', value: DATA.tournament.streamed ? 'Live' : 'No Live Stream' }
  ];
  $('#meta-row').innerHTML = meta.map(m => `
    <div class="meta-chip">
      <span class="label">${m.label}</span>
      <strong>${m.value}</strong>
    </div>
  `).join('');
}

function renderPlayers() {
  $('#players-grid').innerHTML = DATA.players.map(p => `
    <div class="player-card">
      <div class="player-logo"><img src="${img(p.image)}" alt="${p.name}" loading="lazy" decoding="async" /></div>
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
          <div class="team-logo"><img src="${img(p1.image)}" alt="${p1.name}" loading="lazy" decoding="async" /></div>
          <div class="team-name">${p1.name}</div>
          <div class="team-score ${score1Class}">${score1Text}</div>
        </div>
        <div class="vs">VS</div>
        <div class="team">
          <div class="team-logo"><img src="${img(p2.image)}" alt="${p2.name}" loading="lazy" decoding="async" /></div>
          <div class="team-name">${p2.name}</div>
          <div class="team-score ${score2Class}">${score2Text}</div>
        </div>
      </div>
      <div class="match-foot">
        <span>Group</span>
        <span class="status ${m.status}">${m.status === 'live' ? 'Live' : m.status === 'completed' ? 'Final' : 'Upcoming'}</span>
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
    $('#standings-body').innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--muted); padding: 32px;">No matches played yet</td></tr>';
    return;
  }
  $('#standings-body').innerHTML = STANDINGS.map((s, i) => {
    const rankClass = i === 0 ? 'rank-1' : (i === 1 ? 'rank-2' : (i === 2 ? 'rank-3' : ''));
    return `
      <tr>
        <td><span class="rank ${rankClass}">${i + 1}</span></td>
        <td>
          <div class="standings-player">
            <div class="mini-logo"><img src="${img(s.image)}" alt="${s.name}" loading="lazy" decoding="async" /></div>
            ${s.name}
          </div>
        </td>
        <td>${s.gp}</td>
        <td>${s.w}</td>
        <td>${s.d}</td>
        <td>${s.l}</td>
        <td><span class="pts">${s.pts}</span></td>
      </tr>
    `;
  }).join('');
}

function renderKnockout() {
  // Resolve slots from standings:
  // 1 & 2 → Final | 3 & 4 → Semi Final | 5 → eliminated
  const top4 = STANDINGS.slice(0, 4);
  const fillSlot = (slot, playerIdx) => {
    const p = top4[playerIdx];
    if (!p) return `<div class="tbd-slot">TBD</div>`;
    return `
      <div class="tbd-slot is-filled">
        <div class="team-logo"><img src="${img(p.image)}" alt="${p.name}" loading="lazy" decoding="async" /></div>
        <span class="team-name">${p.name}</span>
      </div>
    `;
  };

  const semiReady = top4.length >= 4;
  const finalReady = top4.length >= 2;

  $('#knockout').innerHTML = `
    <div class="knockout-stage">
      <div class="stage-label">Round 1 · 3rd Place Play-off</div>
      <div class="stage-title">SEMI FINAL</div>
      <div class="stage-desc">Best of 3 · 15 min + unlimited ET</div>
      ${fillSlot(null, 2)}
      <div style="margin: 12px 0; color: var(--muted); font-size: 18px;">⚔</div>
      ${fillSlot(null, 3)}
      ${!semiReady ? '<div style="margin-top: 12px; font-size: 11px; color: var(--muted);">Players revealed after group stage</div>' : ''}
    </div>
    <div class="connector">→</div>
    <div class="knockout-stage" style="border-color: rgba(255,209,102,0.3);">
      <div class="stage-label" style="color: var(--gold);">Grand Prize</div>
      <div class="stage-title">🏆 FINAL</div>
      <div class="stage-desc">Best of 3 · 15 min + unlimited ET</div>
      <div class="tbd-slot is-winner">
        ${finalReady ? `<div class="team-logo"><img src="${img(top4[0].image)}" alt="${top4[0].name}" loading="lazy" decoding="async" /></div><span class="team-name">${top4[0].name}</span>` : '<span style="font-family: inherit;">1st Place</span>'}
      </div>
      <div style="margin: 12px 0; color: var(--gold); font-size: 18px;">⚔</div>
      <div class="tbd-slot is-winner">
        ${finalReady ? `<div class="team-logo"><img src="${img(top4[1].image)}" alt="${top4[1].name}" loading="lazy" decoding="async" /></div><span class="team-name">${top4[1].name}</span>` : '<span style="font-family: inherit;">2nd Place</span>'}
      </div>
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

// ───── Fetch + bootstrap ─────

async function loadAll() {
  try {
    const [tRes, sRes] = await Promise.all([
      fetch('/api/tournament'),
      fetch('/api/standings')
    ]);
    if (!tRes.ok || !sRes.ok) throw new Error('API error');
    DATA = await tRes.json();
    STANDINGS = await sRes.json();

    document.title = `${DATA.tournament.name} · 2026`;
    renderHeader();
    renderPlayers();
    renderStandings();
    renderSchedule();
    renderKnockout();
    renderRules();
  } catch (err) {
    console.error('Failed to load:', err);
    document.body.insertAdjacentHTML('beforeend',
      `<div style="position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#ff5577;color:white;padding:12px 20px;border-radius:8px;z-index:9999;">Failed to load tournament data. Refresh to try again.</div>`
    );
  }
}

loadAll();

// Auto-refresh every 30s so scores stay fresh
setInterval(async () => {
  try {
    const sRes = await fetch('/api/standings');
    if (sRes.ok) {
      STANDINGS = await sRes.json();
      renderStandings();
      renderKnockout();
    }
    const mRes = await fetch('/api/tournament');
    if (mRes.ok) {
      DATA = await mRes.json();
      renderSchedule();
    }
  } catch (_) {}
}, 30000);
