/* ──────────────────────────────────────────────
   Rocket League Championship — admin panel
   ────────────────────────────────────────────── */

const TOKEN_KEY = 'rl_admin_token';

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let DATA = null;

function img(path) { return `/images/${path}`; }
function playerById(id) { return DATA.players.find(p => p.id === id); }

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
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

function renderMatchEditor(m, numLabel) {
  const p1 = playerById(m.player1);
  const p2 = playerById(m.player2);
  const s1 = m.score1 ?? '';
  const s2 = m.score2 ?? '';
  const status = m.status;

  return `
    <div class="match-edit ${status}" data-match-id="${m.id}" style="margin-bottom: 10px;">
      <div class="label">${numLabel} · <span style="text-transform: uppercase;">${status}</span></div>

      <div class="team-cell">
        <div class="team-logo"><img src="${img(p1.image)}" alt="${p1.name}" loading="lazy" decoding="async" /></div>
        <span class="name">${p1.name}</span>
      </div>

      <input type="number" min="0" data-side="1" value="${s1}" placeholder="—" />

      <input type="number" min="0" data-side="2" value="${s2}" placeholder="—" />

      <div class="team-cell right">
        <div class="team-logo"><img src="${img(p2.image)}" alt="${p2.name}" loading="lazy" decoding="async" /></div>
        <span class="name">${p2.name}</span>
      </div>

      <div class="actions" style="grid-column: 1 / -1; flex-direction: row; justify-content: flex-end; gap: 8px;">
        <button data-action="reset">Reset</button>
        <button class="save" data-action="save">Save Score</button>
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
  const matches = DATA.matches.filter(m => m.stage === 'group').sort((a, b) => a.order - b.order);
  $('#match-list').innerHTML = matches.map((m, i) => {
    const label = 'M' + String(i + 1).padStart(2, '0');
    return renderMatchEditor(m, label);
  }).join('');
}

async function saveMatch(matchId) {
  const editor = document.querySelector(`[data-match-id="${matchId}"]`);
  const s1 = editor.querySelector('[data-side="1"]').value;
  const s2 = editor.querySelector('[data-side="2"]').value;
  if (s1 === '' || s2 === '') {
    alert('Please enter both scores, or use Reset to clear.');
    return;
  }
  if (Number(s1) < 0 || Number(s2) < 0) {
    alert('Scores must be 0 or greater.');
    return;
  }
  try {
    const updated = await api(`/api/matches/${matchId}`, {
      method: 'PUT',
      body: { score1: Number(s1), score2: Number(s2) }
    });
    // Update local copy
    const idx = DATA.matches.findIndex(m => m.id === matchId);
    if (idx >= 0) DATA.matches[idx] = updated;
    renderMatches();
  } catch (e) {
    alert('Save failed: ' + e.message);
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
    renderMatches();
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
    if (btn.dataset.action === 'reset') resetMatch(id);
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
