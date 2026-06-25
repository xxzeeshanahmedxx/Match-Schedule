/* ──────────────────────────────────────────────
   Rocket League Championship — admin panel
   ────────────────────────────────────────────── */

const TOKEN_KEY = 'rl_admin_token';

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let DATA = null;

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

function img(path) {
  return `${IMAGE_BASES[0]}${path}`;
}

function installImageFallbacks() {
  document.addEventListener('error', event => {
    const el = event.target;
    if (!(el instanceof HTMLImageElement)) return;
    const file = el.dataset.imageFile || (el.getAttribute('src') || '').split('/').pop();
    const nextIndex = Number(el.dataset.fallbackIndex || 0) + 1;
    if (!file || nextIndex >= IMAGE_BASES.length) {
      el.style.display = 'none';
      const holder = el.closest('.team-logo');
      if (holder) holder.textContent = (el.alt || '?').slice(0, 2).toUpperCase();
      return;
    }
    el.dataset.imageFile = file;
    el.dataset.fallbackIndex = String(nextIndex);
    el.src = `${IMAGE_BASES[nextIndex]}${file}`;
  }, true);
}

installImageFallbacks();
function playerById(id) { return DATA.players.find(p => p.id === id) || null; }

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function stageName(stage) {
  if (stage === 'group') return 'Group';
  if (stage === 'semifinal') return 'Semi Final';
  if (stage === 'final') return 'Grand Final';
  return stage;
}

function isGroupComplete() {
  return Boolean(DATA?.meta?.groupStageComplete);
}

function readScheduleFields(editor) {
  return {
    date: editor.querySelector('[data-field="date"]')?.value || null,
    time: editor.querySelector('[data-field="time"]')?.value || null
  };
}

async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  if (opts.body) opts.headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, opts);
  if (res.status === 401) { clearToken(); showLogin(); throw new Error('Unauthorized'); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ───── Login screen ─────

function showLogin() {
  $('#login-screen').style.display = 'block';
  $('#admin-panel').style.display = 'none';
}

function showPanel() {
  $('#login-screen').style.display = 'none';
  $('#admin-panel').style.display = 'block';
}

async function doLogin() {
  const pw = $('#pw').value.trim();
  if (!pw) return;
  $('#login-error').textContent = '';
  $('#login-btn').disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const err = contentType.includes('application/json')
        ? await res.json().catch(() => ({}))
        : { error: await res.text().catch(() => '') };
      throw new Error(err.error || `Login failed (${res.status}). API may not be deployed or D1 may not be bound.`);
    }
    const { token } = await res.json();
    setToken(token);
    showPanel();
    await loadAdmin();
  } catch (e) {
    $('#login-error').textContent = e.message;
  } finally {
    $('#login-btn').disabled = false;
  }
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  clearToken();
  showLogin();
  $('#pw').value = '';
}

// ───── Admin render ─────

function renderTeamCell(player, rank, right = false) {
  const direction = right ? ' right' : '';
  if (!player) {
    return `
      <div class="team-cell${direction} is-tbd">
        <div class="tbd-avatar">?</div>
        <span class="name">${ordinal(rank)} Place</span>
      </div>
    `;
  }
  return `
    <div class="team-cell${direction}">
      <div class="team-logo"><img src="${img(player.image)}" alt="${player.name}" data-image-file="${player.image}" loading="lazy" decoding="async" /></div>
      <span class="name">${player.name}</span>
    </div>
  `;
}

function renderMatchEditor(m, numLabel) {
  const p1 = playerById(m.player1);
  const p2 = playerById(m.player2);
  const s1 = m.score1 ?? '';
  const s2 = m.score2 ?? '';
  const matchDate = m.date || '';
  const matchTime = m.time || '';
  const status = m.status;
  const locked = m.stage !== 'group' && !isGroupComplete();
  const disabled = locked ? 'disabled' : '';
  const stage = stageName(m.stage);
  const stageHint = m.stage === 'group'
    ? '10 min + 5 min ET'
    : `${m.series || 'Best of 3'} · ${m.minutes || 15} min + ${m.extraTime || 'unlimited'} ET`;

  return `
    <div class="match-edit ${status} ${locked ? 'is-locked' : ''}" data-match-id="${m.id}" style="margin-bottom: 10px;">
      <div class="label">
        ${numLabel} · ${stage} · <span style="text-transform: uppercase;">${status}</span>
        <small>${stageHint}</small>
      </div>

      ${renderTeamCell(p1, m.slot1Rank, false)}

      <input type="number" min="0" step="1" inputmode="numeric" data-side="1" value="${s1}" placeholder="—" ${disabled} />

      <input type="number" min="0" step="1" inputmode="numeric" data-side="2" value="${s2}" placeholder="—" ${disabled} />

      ${renderTeamCell(p2, m.slot2Rank, true)}

      <div class="schedule-fields">
        <label>
          <span>Date</span>
          <input type="date" data-field="date" value="${matchDate}" />
        </label>
        <label>
          <span>Time</span>
          <input type="time" data-field="time" value="${matchTime}" />
        </label>
      </div>

      <div class="actions" style="grid-column: 1 / -1; flex-direction: row; justify-content: flex-end; gap: 8px;">
        ${locked ? '<span class="locked-note">Finish group stage to unlock scores</span>' : ''}
        <button data-action="schedule">Save Date/Time</button>
        <button data-action="reset" ${disabled}>Reset</button>
        <button class="live" data-action="live" ${disabled}>Mark Live</button>
        <button class="save" data-action="save" ${disabled}>Save Score</button>
      </div>
    </div>
  `;
}

async function loadAdmin() {
  try {
    DATA = await api('/api/tournament');
    renderMatches();
  } catch (e) {
    console.error(e);
  }
}

function renderMatches() {
  const group = DATA.matches.filter(m => m.stage === 'group').sort((a, b) => a.order - b.order);
  const knockout = DATA.matches.filter(m => m.stage !== 'group').sort((a, b) => a.order - b.order);
  const groupCompleted = DATA.meta?.groupCompleted ?? group.filter(m => m.status === 'completed').length;
  const groupTotal = DATA.meta?.groupTotal ?? group.length;

  const groupHtml = group.map((m, i) => renderMatchEditor(m, 'M' + String(i + 1).padStart(2, '0'))).join('');
  const knockoutHtml = knockout.map((m, i) => renderMatchEditor(m, m.stage === 'final' ? 'FINAL' : 'SF')).join('');

  $('#match-list').innerHTML = `
    <div class="admin-section-title">
      <h2>Group Stage</h2>
      <span>${groupCompleted}/${groupTotal} completed</span>
    </div>
    ${groupHtml}

    <div class="admin-section-title knockout-title">
      <h2>Knockout Stage</h2>
      <span>${isGroupComplete() ? 'Unlocked' : 'Locked until group stage ends'}</span>
    </div>
    ${!isGroupComplete() ? '<div class="admin-warning">Knockout participants are based on final standings and will be revealed once all group matches are completed.</div>' : ''}
    ${knockoutHtml}
  `;
}

async function saveMatch(matchId) {
  const editor = document.querySelector(`[data-match-id="${matchId}"]`);
  if (editor?.classList.contains('is-locked')) {
    alert('Finish all group-stage matches before editing knockout results.');
    return;
  }
  const s1 = editor.querySelector('[data-side="1"]').value;
  const s2 = editor.querySelector('[data-side="2"]').value;
  const schedule = readScheduleFields(editor);
  if (s1 === '' || s2 === '') {
    alert('Please enter both scores, or use Reset to clear.');
    return;
  }
  if (!Number.isInteger(Number(s1)) || !Number.isInteger(Number(s2)) || Number(s1) < 0 || Number(s2) < 0) {
    alert('Scores must be whole numbers 0 or greater.');
    return;
  }
  try {
    const updated = await api(`/api/matches/${matchId}`, {
      method: 'PUT',
      body: { score1: Number(s1), score2: Number(s2), ...schedule }
    });
    const idx = DATA.matches.findIndex(m => m.id === matchId);
    if (idx >= 0) DATA.matches[idx] = updated;
    await loadAdmin();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

async function saveSchedule(matchId) {
  const editor = document.querySelector(`[data-match-id="${matchId}"]`);
  try {
    const updated = await api(`/api/matches/${matchId}`, {
      method: 'PUT',
      body: readScheduleFields(editor)
    });
    const idx = DATA.matches.findIndex(m => m.id === matchId);
    if (idx >= 0) DATA.matches[idx] = updated;
    await loadAdmin();
  } catch (e) {
    alert('Date/time save failed: ' + e.message);
  }
}

async function markLive(matchId) {
  const editor = document.querySelector(`[data-match-id="${matchId}"]`);
  if (editor?.classList.contains('is-locked')) {
    alert('Finish all group-stage matches before editing knockout results.');
    return;
  }
  try {
    const updated = await api(`/api/matches/${matchId}`, {
      method: 'PUT',
      body: { status: 'live', ...readScheduleFields(editor) }
    });
    const idx = DATA.matches.findIndex(m => m.id === matchId);
    if (idx >= 0) DATA.matches[idx] = updated;
    await loadAdmin();
  } catch (e) {
    alert('Mark live failed: ' + e.message);
  }
}

async function resetMatch(matchId) {
  if (!confirm('Clear the result for this match?')) return;
  try {
    const updated = await api(`/api/matches/${matchId}`, {
      method: 'PUT',
      body: { score1: null, score2: null, status: 'upcoming' }
    });
    const idx = DATA.matches.findIndex(m => m.id === matchId);
    if (idx >= 0) DATA.matches[idx] = updated;
    await loadAdmin();
  } catch (e) {
    alert('Reset failed: ' + e.message);
  }
}

async function resetAll() {
  if (!confirm('Reset ALL match results? This cannot be undone.')) return;
  try {
    await api('/api/reset', { method: 'POST' });
    await loadAdmin();
  } catch (e) {
    alert('Reset failed: ' + e.message);
  }
}

// ───── Event wiring ─────

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (btn) {
    const editor = btn.closest('.match-edit');
    const id = editor?.dataset.matchId;
    if (!id) return;
    if (btn.dataset.action === 'save') saveMatch(id);
    if (btn.dataset.action === 'schedule') saveSchedule(id);
    if (btn.dataset.action === 'reset') resetMatch(id);
    if (btn.dataset.action === 'live') markLive(id);
    return;
  }
});

$('#login-btn').addEventListener('click', doLogin);
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('#logout-btn').addEventListener('click', doLogout);
$('#reset-all').addEventListener('click', resetAll);

// ───── Bootstrap ─────
if (getToken()) {
  showPanel();
  loadAdmin().catch(() => { clearToken(); showLogin(); });
} else {
  showLogin();
}
