/* ══════════════════════════════════════════════════════════════════════════════
   AdSync — Unified Social Media Ads Platform  |  app.js
   ══════════════════════════════════════════════════════════════════════════════ */

// ── Theme (runs before DOM) ───────────────────────────────────────────────────
(function () {
  const t = localStorage.getItem('adsync-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('adsync-theme', t);
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
}

// ── Platform SVGs ─────────────────────────────────────────────────────────────
const SVG = {
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#1877F2">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388
    10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669
    4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491
    0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612
    23.027 24 18.062 24 12.073z"/></svg>`,

  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <defs><linearGradient id="igG" x1="0%" y1="100%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="#F58529"/>
    <stop offset="50%" stop-color="#DD2A7B"/>
    <stop offset="100%" stop-color="#8134AF"/>
    </linearGradient></defs>
    <path fill="url(#igG)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148
    4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012
    3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07
    -4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92
    -.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227
    1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259
    0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073
    1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98
    6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354
    -.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014
    -3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69
    -.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163
    6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0
    10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0
    2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44
    1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,

  twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17
    l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713
    5.923zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,

  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0A66C2">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853
    0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9
    1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337
    7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063
    1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782
    13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0
    1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24
    22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,

  tiktok: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path fill="currentColor" d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67
    a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89
    c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34
    6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0
    004.79 1.53V6.78a4.85 4.85 0 01-1.02-.09z"/></svg>`,

  pinterest: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#E60023">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627
    11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965
    1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914
    2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655
    2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133
    0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882
    -3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893
    2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267
    -.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75
    -7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136
    -2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748
    2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763
    24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>`,
};

// ── Connection guides shown in modal ─────────────────────────────────────────
const GUIDES = {
  facebook: `<b>✅ Token is auto-exchanged for you</b><br>
    Just paste your User Access Token — we automatically convert it to a Page Token.<br><br>
    <b>How to get your token:</b><br>
    1. Go to <a href="https://developers.facebook.com/tools/explorer" target="_blank">Graph API Explorer</a><br>
    2. Select your <b>Facebook Page</b> (not a Group) from the top dropdown<br>
    3. Click <b>Generate Access Token</b> → grant <code>pages_manage_posts</code> + <code>pages_read_engagement</code><br>
    4. Copy the token and paste it below<br><br>
    <b>Page ID:</b> Go to your Page → <b>About</b> → <b>Page Transparency</b> → copy the numeric ID<br>
    <span style="color:#f87171">⚠️ Do NOT enter a Group ID — that causes Error #200</span>`,

  instagram: `<b>Get Instagram credentials:</b><br>
    1. Your Instagram account must be a <b>Business</b> or <b>Creator</b> account<br>
    2. Connect it to a <b>Facebook Page</b><br>
    3. <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a>
    → Instagram Graph API → token with <code>instagram_content_publish</code><br>
    4. Account ID: <code>GET /{page-id}?fields=instagram_business_account</code><br>
    <b>⚠️ Requires image or video — text-only not supported</b>`,

  twitter: `<b>Get Twitter / X credentials:</b><br>
    1. <a href="https://developer.twitter.com" target="_blank">developer.twitter.com</a>
    → Create Project + App<br>
    2. <b>User Auth Settings → Read &amp; Write</b> (required!)<br>
    3. Keys and Tokens → copy API Key, API Secret, Access Token, Access Token Secret<br>
    <b>⚠️ Regenerate tokens AFTER setting Read+Write permissions</b>`,

  linkedin: `<b>Get LinkedIn credentials:</b><br>
    1. <a href="https://www.linkedin.com/developers" target="_blank">linkedin.com/developers</a>
    → Create App<br>
    2. Products → request <b>Share on LinkedIn</b> → scope: <code>w_member_social</code><br>
    3. Auth tab → OAuth 2.0 Token Generator → copy token<br>
    4. Person URN format: <code>urn:li:person:XXXXXX</code>`,

  tiktok: `<b>Get TikTok credentials:</b><br>
    1. <a href="https://developers.tiktok.com" target="_blank">developers.tiktok.com</a>
    → Create App → Content Posting API<br>
    2. OAuth 2.0 flow → copy <code>access_token</code> and <code>open_id</code><br>
    3. Required scopes: <code>video.upload</code> + <code>video.publish</code><br>
    <b>⚠️ TikTok requires video or image — no text/audio-only</b>`,

  pinterest: `<b>Get Pinterest credentials:</b><br>
    1. <a href="https://developers.pinterest.com" target="_blank">developers.pinterest.com</a>
    → Create App<br>
    2. OAuth2 scopes: <code>boards:read</code> + <code>pins:write</code><br>
    3. Board ID: from board URL or <code>GET /v5/boards</code><br>
    <b>⚠️ Pinterest requires image or video — no audio</b>`,
};

const MEDIA_ICON = { image: '🖼️', video: '🎬', audio: '🎵', text: '📝' };

// ── App state ─────────────────────────────────────────────────────────────────
let platforms        = [];
let uploadedMedia    = null;
let lastEventId      = null;
let selectedPlatforms = new Set();

// ── DOM-ready init ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Sync theme buttons
  const theme = localStorage.getItem('adsync-theme') || 'dark';
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme));

  // Default schedule time = now + 1 hour
  const el = document.getElementById('scheduleAt');
  if (el) {
    const d = new Date(Date.now() + 3_600_000);
    d.setSeconds(0, 0);
    el.value = d.toISOString().slice(0, 16);
  }

  // Char counter
  const txt = document.getElementById('adText');
  if (txt) {
    txt.addEventListener('input', () => {
      const n = txt.value.length;
      const el2 = document.getElementById('charCount');
      if (el2) {
        el2.textContent = n;
        el2.style.color = n > 240 ? 'var(--amber)' : '';
      }
    });
  }

  // Drag-drop
  const dz = document.getElementById('dropZone');
  if (dz) {
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  }
  const fi = document.getElementById('fileInput');
  if (fi) fi.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Boot
  loadPlatforms().then(() => startPolling());
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p =>
    p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'history')   loadHistory();
  if (tab === 'analytics') loadAnalytics();
  if (tab === 'schedule')  loadScheduled();
}

// ── Realtime polling ──────────────────────────────────────────────────────────
function startPolling() {
  setInterval(async () => {
    try {
      const url = lastEventId ? `/api/events?since=${lastEventId}` : '/api/events';
      const d = await fetch(url).then(r => r.json());
      (d.events || []).forEach(handleEvent);
      if (d.events?.length) lastEventId = d.events.at(-1).id;
      setLive(true);
    } catch { setLive(false); }
  }, 2000);
}

function handleEvent(evt) {
  if (evt.type === 'platform_status') {
    const p = platforms.find(x => x.id === evt.data.platform);
    if (p) {
      p.connected    = evt.data.connected;
      p.account_info = evt.data.account_info || {};
    }
    renderPlatforms();
    renderConnBar();
    renderPlatformSelector();
  }
}

function setLive(on) {
  const dot = document.getElementById('liveDot');
  const lbl = document.getElementById('liveLabel');
  if (dot) dot.classList.toggle('on', on);
  if (lbl) lbl.textContent = on ? 'Live' : 'Reconnecting…';
}

// ── Load & render platforms ───────────────────────────────────────────────────
async function loadPlatforms() {
  const d = await fetch('/api/platforms').then(r => r.json());
  platforms = d.platforms || [];
  renderPlatforms();
  renderConnBar();
  renderPlatformSelector();
}

function renderPlatforms() {
  const el = document.getElementById('platformsList');
  if (!el) return;

  const connected = platforms.filter(p => p.connected).length;
  document.getElementById('connCount').textContent = `${connected} live`;

  el.innerHTML = platforms.map(p => {
    const userLine = p.account_info?.name
      ? `<div class="pc-user">${esc(p.account_info.username
          ? '@' + p.account_info.username
          : p.account_info.name)}</div>`
      : '';
    const types = (p.supported_types || [])
      .map(t => `<span class="type-chip">${MEDIA_ICON[t] || ''} ${t}</span>`).join('');
    const btn = p.connected
      ? `<button class="btn-disconnect" onclick="disconnectPlatform('${p.id}')">⏏ Disconnect</button>`
      : `<button class="btn-connect" onclick="openConnectModal('${p.id}')">⚡ Connect</button>`;

    return `
    <div class="plat-card ${p.connected ? 'connected' : ''}" id="pc-${p.id}"
         style="--plat-color:${p.color}">
      <div class="pc-row1">
        <div class="pc-meta">
          <div class="pc-icon">${SVG[p.id] || '📱'}</div>
          <div>
            <div class="pc-name">${p.name}</div>
            ${userLine}
          </div>
        </div>
        <span class="status-pill ${p.connected ? 'live' : 'off'}">
          ${p.connected ? 'LIVE' : 'OFF'}
        </span>
      </div>
      <div class="pc-types">${types}</div>
      <div class="pc-actions">${btn}</div>
    </div>`;
  }).join('');
}

function renderConnBar() {
  const el = document.getElementById('connChips');
  if (!el) return;
  const live = platforms.filter(p => p.connected);
  if (!live.length) {
    el.innerHTML = '<span class="no-conn-text">No platforms connected yet — connect one on the left</span>';
    return;
  }
  el.innerHTML = live.map(p => `
    <span class="conn-chip">
      <span style="display:inline-flex;width:14px;height:14px">${SVG[p.id] || ''}</span>
      ${p.name}
    </span>`).join('');
}

function renderPlatformSelector() {
  const el = document.getElementById('platformSelector');
  if (!el) return;
  const live = platforms.filter(p => p.connected);

  if (!live.length) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:.9rem">Connect platforms in the sidebar first.</span>';
    return;
  }

  // Auto-select newly connected platforms
  live.forEach(p => selectedPlatforms.add(p.id));
  // Remove disconnected ones
  [...selectedPlatforms].forEach(id => {
    if (!live.find(p => p.id === id)) selectedPlatforms.delete(id);
  });

  el.innerHTML = live.map(p => {
    const sel = selectedPlatforms.has(p.id);
    return `
    <div class="plat-toggle ${sel ? 'selected' : ''}" onclick="togglePlatform('${p.id}')">
      <div class="toggle-check">${sel ? '✓' : ''}</div>
      <span style="display:inline-flex;width:17px;height:17px">${SVG[p.id] || ''}</span>
      ${p.name}
    </div>`;
  }).join('');

  updatePlatformNotes();
}

function togglePlatform(id) {
  if (selectedPlatforms.has(id)) selectedPlatforms.delete(id);
  else selectedPlatforms.add(id);
  renderPlatformSelector();
}

function updatePlatformNotes() {
  const notesEl = document.getElementById('platformNotes');
  if (!notesEl) return;
  const notes = [];
  const media = uploadedMedia?.media_type;

  if (selectedPlatforms.has('instagram') && !media)
    notes.push('📸 <b>Instagram</b> requires an image or video — text-only not supported.');
  if (selectedPlatforms.has('tiktok') && (!media || media === 'audio'))
    notes.push('🎵 <b>TikTok</b> requires a video or image — audio-only not supported.');
  if (selectedPlatforms.has('pinterest') && (!media || media === 'audio'))
    notes.push('📌 <b>Pinterest</b> requires an image or video — audio-only not supported.');
  if (selectedPlatforms.has('twitter') && document.getElementById('adText')?.value?.length > 240)
    notes.push('🐦 <b>Twitter/X</b> — tweet will be auto-trimmed to 280 characters.');

  notesEl.style.display = notes.length ? 'block' : 'none';
  notesEl.innerHTML = notes.join('<br>');
}

// ── Connect modal ─────────────────────────────────────────────────────────────
let _modalPlatformId = null;

function openConnectModal(pid) {
  _modalPlatformId = pid;
  const p = platforms.find(x => x.id === pid);
  if (!p) return;

  document.getElementById('mIcon').innerHTML  = SVG[pid] || '📱';
  document.getElementById('mTitle').textContent = `Connect ${p.name}`;
  document.getElementById('mGuide').innerHTML = GUIDES[pid] || 'Enter your credentials below.';
  document.getElementById('mError').style.display = 'none';
  document.getElementById('mFields').innerHTML = (p.required_credentials || []).map(c => `
    <div class="cred-field">
      <label class="cred-label">${c.label}</label>
      <input class="cred-input" id="cred_${c.key}"
             type="${c.type === 'password' ? 'password' : 'text'}"
             placeholder="${c.label}" autocomplete="off">
      ${c.help ? `<div class="cred-hint">${c.help}</div>` : ''}
    </div>`).join('');

  const btn = document.getElementById('mConnBtn');
  btn.textContent = 'Connect';
  btn.disabled = false;

  document.getElementById('connectModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('connectModal').style.display = 'none';
  _modalPlatformId = null;
}

async function submitConnect() {
  if (!_modalPlatformId) return;
  const p = platforms.find(x => x.id === _modalPlatformId);
  const creds = {};
  (p.required_credentials || []).forEach(c => {
    creds[c.key] = document.getElementById(`cred_${c.key}`)?.value?.trim() || '';
  });

  const btn = document.getElementById('mConnBtn');
  btn.textContent = 'Connecting…';
  btn.disabled = true;
  document.getElementById('mError').style.display = 'none';

  try {
    const d = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: _modalPlatformId, credentials: creds }),
    }).then(r => r.json());

    if (d.success) {
      const pl = platforms.find(x => x.id === _modalPlatformId);
      if (pl) { pl.connected = true; pl.account_info = d.account_info || {}; }
      closeModal();
      renderPlatforms();
      renderConnBar();
      renderPlatformSelector();
      toast('ok', `✅ Connected to ${p.name}!`);
    } else {
      document.getElementById('mError').textContent = d.error || 'Connection failed.';
      document.getElementById('mError').style.display = 'block';
      btn.textContent = 'Try Again';
      btn.disabled = false;
    }
  } catch (err) {
    document.getElementById('mError').textContent = 'Network error: ' + err.message;
    document.getElementById('mError').style.display = 'block';
    btn.textContent = 'Try Again';
    btn.disabled = false;
  }
}

async function disconnectPlatform(id) {
  await fetch('/api/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: id }),
  });
  const p = platforms.find(x => x.id === id);
  if (p) { p.connected = false; p.account_info = {}; }
  selectedPlatforms.delete(id);
  renderPlatforms();
  renderConnBar();
  renderPlatformSelector();
  toast('info', `Disconnected from ${p?.name || id}`);
}

// ── File upload ───────────────────────────────────────────────────────────────
async function handleFile(file) {
  const prog = document.getElementById('uploadProgress');
  const fill = document.getElementById('progressFill');
  const txt  = document.getElementById('progressText');

  prog.style.display = 'block';
  fill.style.width = '8%';
  fill.style.background = 'var(--accent)';
  txt.textContent = `Uploading ${file.name}…`;

  let pct = 8;
  const iv = setInterval(() => { pct = Math.min(pct + 5, 80); fill.style.width = pct + '%'; }, 220);

  try {
    const fd = new FormData();
    fd.append('file', file);
    const d = await fetch('/api/upload', { method: 'POST', body: fd }).then(r => r.json());

    clearInterval(iv);
    fill.style.width = '100%';

    if (d.success) {
      uploadedMedia = d;
      txt.textContent = `✓ ${file.name}  (${(d.size / 1024 / 1024).toFixed(2)} MB)`;
      setTimeout(() => { prog.style.display = 'none'; }, 2000);
      renderMediaPreview(d);
      updatePlatformNotes();
      toast('ok', `${MEDIA_ICON[d.media_type] || '📎'} ${d.media_type.toUpperCase()} uploaded — ready to post`);
    } else {
      txt.textContent = '✗ ' + (d.error || 'Upload failed');
      fill.style.background = 'var(--red)';
      toast('err', d.error || 'Upload failed');
    }
  } catch (err) {
    clearInterval(iv);
    fill.style.background = 'var(--red)';
    txt.textContent = '✗ Network error: ' + err.message;
    toast('err', 'Upload error: ' + err.message);
  }
}

function renderMediaPreview(d) {
  document.getElementById('dropPlaceholder').style.display = 'none';
  const preview = document.getElementById('dropPreview');
  preview.style.display = 'block';

  const wrap = document.getElementById('previewWrap');
  if (d.media_type === 'image') {
    wrap.innerHTML = `<img src="${d.filepath}" alt="Preview" style="max-width:100%;max-height:280px;border-radius:10px;object-fit:contain;display:block">`;
  } else if (d.media_type === 'video') {
    wrap.innerHTML = `<video src="${d.filepath}" controls style="max-width:100%;max-height:280px;border-radius:10px;display:block"></video>`;
  } else if (d.media_type === 'audio') {
    wrap.innerHTML = `
      <div style="background:var(--bg-active);border-radius:12px;padding:20px 24px;display:flex;align-items:center;gap:14px">
        <span style="font-size:2.4rem">🎵</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.95rem;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(d.filename.split('_').slice(1).join('_') || d.filename)}
          </div>
          <audio src="${d.filepath}" controls style="width:100%"></audio>
        </div>
      </div>`;
  } else {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;font-size:.95rem">📎 ${esc(d.filename)}</div>`;
  }

  // Badge
  const existing = document.getElementById('mediaBadge');
  if (existing) existing.remove();
  const badge = document.createElement('div');
  badge.id = 'mediaBadge';
  badge.className = 'media-type-badge';
  badge.innerHTML = `${MEDIA_ICON[d.media_type] || '📎'} ${d.media_type.toUpperCase()} — will be attached to all selected platforms`;
  wrap.after(badge);

  document.getElementById('previewMeta').textContent =
    `${d.filename.split('_').slice(1).join('_') || d.filename}  ·  ${(d.size / 1024 / 1024).toFixed(2)} MB`;
}

function removeMedia() {
  uploadedMedia = null;
  document.getElementById('dropPlaceholder').style.display = '';
  document.getElementById('dropPreview').style.display = 'none';
  document.getElementById('previewWrap').innerHTML = '';
  document.getElementById('previewMeta').textContent = '';
  document.getElementById('fileInput').value = '';
  const b = document.getElementById('mediaBadge');
  if (b) b.remove();
  updatePlatformNotes();
}

// ── Build content payload ─────────────────────────────────────────────────────
function buildContent() {
  return {
    ad_title:       document.getElementById('adTitle')?.value?.trim() || '',
    text:           document.getElementById('adText')?.value?.trim()  || '',
    call_to_action: document.getElementById('adCta')?.value?.trim()   || '',
    hashtags:       (document.getElementById('adHashtags')?.value || '')
                      .split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean),
    link:           document.getElementById('adLink')?.value?.trim()  || '',
    media_url:      uploadedMedia?.filepath   || '',
    media_type:     uploadedMedia?.media_type || 'text',
  };
}

// ── Post ad ───────────────────────────────────────────────────────────────────
async function postAd() {
  const targets = [...selectedPlatforms].filter(id =>
    platforms.find(p => p.id === id && p.connected));

  if (!targets.length) {
    toast('err', 'Select at least one connected platform.');
    return;
  }
  const text  = document.getElementById('adText')?.value?.trim();
  const title = document.getElementById('adTitle')?.value?.trim();
  if (!text && !title && !uploadedMedia) {
    toast('err', 'Add a headline, ad copy, or upload media first.');
    return;
  }

  const content = buildContent();
  showPostingOverlay(targets);

  try {
    const d = await fetch('/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, platforms: targets }),
    }).then(r => r.json());

    // Update each row immediately from the response
    Object.entries(d.results || {}).forEach(([pid, res]) => {
      updatePostRow(pid, res.success ? 'success' : 'failed', res.error, res.post_url);
    });

    // Finalize overlay
    const spinner = document.getElementById('postSpinner');
    const title2  = document.getElementById('postDialogTitle');
    const closeBtn = document.getElementById('btnCloseOverlay');
    if (spinner)  { spinner.style.animation = 'none'; spinner.textContent = d.success ? '🎉' : '⚠️'; }
    if (title2)   title2.textContent = d.success ? 'Ad Published Successfully!' : 'Some Platforms Failed';
    if (closeBtn) closeBtn.style.display = 'block';

    if (d.success) {
      toast('ok', '🚀 Ad is live on all selected platforms!');
      loadHistory();
    } else {
      toast('err', 'Check the results — some platforms failed.');
    }

  } catch (err) {
    closePostingOverlay();
    toast('err', 'Request failed: ' + err.message);
  }
}

function showPostingOverlay(targets) {
  const spinner  = document.getElementById('postSpinner');
  const titleEl  = document.getElementById('postDialogTitle');
  const closeBtn = document.getElementById('btnCloseOverlay');
  const results  = document.getElementById('postResults');

  if (spinner)  { spinner.textContent = '⚡'; spinner.style.animation = 'spin 1s linear infinite'; }
  if (titleEl)  titleEl.textContent = 'Publishing Ad…';
  if (closeBtn) closeBtn.style.display = 'none';
  if (results)  results.innerHTML = targets.map(pid => {
    const p   = platforms.find(x => x.id === pid);
    const med = uploadedMedia ? `<span style="font-size:.75rem;opacity:.6;margin-left:4px">+${uploadedMedia.media_type}</span>` : '';
    return `
    <div class="post-result-row" id="prr-${pid}">
      <span style="display:inline-flex;width:20px;height:20px;flex-shrink:0">${SVG[pid] || '📡'}</span>
      <span class="post-result-name">${p?.name || pid}${med}</span>
      <span class="post-result-status posting" id="prs-${pid}">Posting…</span>
    </div>`;
  }).join('');

  document.getElementById('postOverlay').style.display = 'flex';
}

function updatePostRow(pid, status, error, url) {
  const el = document.getElementById(`prs-${pid}`);
  if (!el) return;
  el.className = `post-result-status ${status}`;
  if (status === 'success') {
    el.textContent = url ? '✅ Live' : '✅ Posted';
  } else {
    const msg = (error || 'Failed').slice(0, 120);
    el.textContent = `❌ ${msg}`;
    el.title = error || '';
  }
}

function closePostingOverlay() {
  document.getElementById('postOverlay').style.display = 'none';
  // Reset spinner
  const s = document.getElementById('postSpinner');
  if (s) { s.textContent = '⚡'; s.style.animation = 'spin 1s linear infinite'; }
}

// ── Schedule ──────────────────────────────────────────────────────────────────
async function scheduleAd() {
  const at = document.getElementById('scheduleAt')?.value;
  if (!at) { toast('err', 'Pick a date and time.'); return; }

  const targets = [...selectedPlatforms].filter(id =>
    platforms.find(p => p.id === id && p.connected));
  if (!targets.length) { toast('err', 'Select at least one connected platform.'); return; }

  const content = buildContent();
  try {
    const d = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        platforms: targets,
        scheduled_at: new Date(at).toISOString(),
      }),
    }).then(r => r.json());

    if (d.success) {
      toast('ok', `🕐 Scheduled for ${new Date(at).toLocaleString()}`);
      loadScheduled();
    } else {
      toast('err', d.error || 'Schedule failed');
    }
  } catch (err) {
    toast('err', err.message);
  }
}

async function loadScheduled() {
  const d   = await fetch('/api/schedule').then(r => r.json());
  const el  = document.getElementById('scheduledList');
  const all = d.scheduled || [];
  if (!el) return;

  if (!all.length) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-icon">🕐</span>No scheduled posts yet.</div>`;
    return;
  }

  const STATUS_CHIP = { pending: 'chip-warn', completed: 'chip-ok', failed: 'chip-fail', cancelled: 'chip-cancel' };

  el.innerHTML = all.map(s => {
    const dt   = new Date(s.scheduled_at).toLocaleString();
    const chip = STATUS_CHIP[s.status] || 'chip-cancel';
    const med  = s.content?.media_type && s.content.media_type !== 'text'
      ? `<span class="chip chip-media">${MEDIA_ICON[s.content.media_type] || ''} ${s.content.media_type}</span>` : '';
    const pils = (s.platforms || []).map(pid => `<span class="chip chip-cancel">${pid}</span>`).join('');
    const cancelBtn = s.status === 'pending'
      ? `<div class="sched-actions"><button class="btn-ghost" onclick="cancelScheduled('${s.id}')">Cancel</button></div>` : '';

    return `
    <div class="hist-card">
      <div class="hist-card-top">
        <span class="hist-title">${esc(s.content?.ad_title || 'Scheduled Post')}</span>
        <span class="hist-time">${dt}</span>
      </div>
      <div class="hist-text">${esc((s.content?.text || '').slice(0, 120))}${(s.content?.text?.length > 120) ? '…' : ''}</div>
      <div class="chip-row">
        <span class="chip ${chip}">${s.status.toUpperCase()}</span>
        ${med}${pils}
      </div>
      ${cancelBtn}
    </div>`;
  }).join('');
}

async function cancelScheduled(id) {
  const d = await fetch(`/api/schedule/${id}`, { method: 'DELETE' }).then(r => r.json());
  if (d.success) { toast('ok', 'Scheduled post cancelled.'); loadScheduled(); }
  else toast('err', d.error || 'Cancel failed');
}

// ── History ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  const d   = await fetch('/api/history').then(r => r.json());
  const el  = document.getElementById('historyList');
  const his = d.history || [];
  if (!el) return;

  if (!his.length) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-icon">📭</span>No posts yet. Publish your first ad!</div>`;
    return;
  }

  el.innerHTML = his.map(item => {
    const dt  = new Date(item.timestamp).toLocaleString();
    const med = item.content?.media_type && item.content.media_type !== 'text'
      ? `<span class="chip chip-media">${MEDIA_ICON[item.content.media_type] || ''} ${item.content.media_type}</span>` : '';
    const chips = Object.entries(item.results || {}).map(([pid, res]) =>
      `<span class="chip ${res.success ? 'chip-ok' : 'chip-fail'}">${pid} ${res.success ? '✓' : '✗'}</span>`
    ).join('');

    return `
    <div class="hist-card">
      <div class="hist-card-top">
        <span class="hist-title">${esc(item.content?.ad_title || 'Untitled Ad')}</span>
        <span class="hist-time">${dt}</span>
      </div>
      <div class="hist-text">${esc((item.content?.text || '').slice(0, 140))}${(item.content?.text?.length > 140) ? '…' : ''}</div>
      <div class="chip-row">${med}${chips}</div>
    </div>`;
  }).join('');
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const d = await fetch('/api/stats').then(r => r.json());

  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v ?? '—'; };
  set('sTotalPosts', d.total_posts);
  set('sSucceeded',  d.successful);
  set('sFailed',     d.failed);
  set('sScheduled',  d.scheduled_pending);

  const el = document.getElementById('platformStats');
  if (!el) return;

  const entries = Object.entries(d.per_platform || {}).filter(([, s]) => s.sent > 0);
  if (!entries.length) {
    el.innerHTML = `<div class="empty-msg"><span class="empty-icon">📊</span>No data yet — post your first ad!</div>`;
    return;
  }

  el.innerHTML = entries.map(([pid, s]) => {
    const p   = platforms.find(x => x.id === pid);
    const pct = s.sent > 0 ? Math.round(s.succeeded / s.sent * 100) : 0;
    return `
    <div class="plat-stat-row">
      <div class="plat-stat-icon">${SVG[pid] || '📱'}</div>
      <span class="plat-stat-name">${p?.name || pid}</span>
      <div class="plat-stat-nums">
        <span class="stat-ok">✓ ${s.succeeded}</span>
        <span class="stat-fail">✗ ${s.sent - s.succeeded}</span>
        <span class="stat-total">${s.sent} total</span>
      </div>
      <div class="plat-stat-bar">
        <div class="stat-track"><div class="stat-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

// ── Toasts ────────────────────────────────────────────────────────────────────
function toast(type, msg) {
  const icons = { ok: '✅', err: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span>
                  <span class="toast-msg">${msg}</span>`;
  document.getElementById('toastStack').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .35s, transform .35s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 380);
  }, 5000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
