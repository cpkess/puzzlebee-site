/* PuzzleBee Admin Panel */

const SUPABASE_URL = 'https://slepfovcxclwpcuqmhql.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_Hhyy2Et18FafeDZjZrn4kg_KdFeN7AF';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ──────────────────────────────────────────────────────────────────
let currentTab = 'queue';
let queueBadge = 0;

// Storage bucket that holds puzzle pictures. The real name is detected from the
// URLs of pictures already on the puzzles; this is only used as a fallback when
// no puzzle has a picture yet.
const FALLBACK_IMAGE_BUCKET = 'puzzle-photos';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

function showToast(msg, type = 'success') {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', 'toast');
    t.style.cssText = `
      position:fixed;bottom:28px;right:28px;z-index:9999;
      padding:12px 20px;border-radius:10px;font-size:.875rem;font-weight:600;
      box-shadow:0 4px 20px rgba(0,0,0,.15);transition:opacity .3s;
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#FDEAEA' : '#EAF5EC';
  t.style.color      = type === 'error' ? '#B83232' : '#3A7D44';
  t.style.border     = type === 'error' ? '1px solid rgba(184,50,50,.2)' : '1px solid rgba(58,125,68,.2)';
  t.style.opacity    = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await enterApp(session.user);
  } else {
    showAuth();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await enterApp(session.user);
    } else if (event === 'SIGNED_OUT') {
      showAuth();
    }
  });
}

function showAuth() {
  $('auth').style.display = '';
  $('app').classList.remove('visible');
}

async function enterApp(user) {
  const { data: profile, error: profileError } = await sb.from('profiles').select('is_admin, username').eq('id', user.id).single();
  if (profileError || !profile || !profile.is_admin) {
    await sb.auth.signOut();
    const reason = profileError ? profileError.message : (!profile ? 'No profile found for user ' + user.id : 'is_admin = ' + profile.is_admin);
    $('auth-error').textContent = 'Access denied: ' + reason;
    $('auth-error').style.display = 'block';
    return;
  }
  $('auth').style.display = 'none';
  $('app').classList.add('visible');
  $('sidebar-user').textContent = profile.username || user.email;
  navigateTo('queue');
}

$('google-signin-btn').addEventListener('click', async () => {
  $('google-signin-btn').style.opacity = '0.6';
  $('google-signin-btn').disabled = true;
  $('auth-error').style.display = 'none';

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://puzzlebee.app/admin/' },
  });

  if (error) {
    $('auth-error').textContent = error.message;
    $('auth-error').style.display = 'block';
    $('google-signin-btn').style.opacity = '1';
    $('google-signin-btn').disabled = false;
  }
});

$('sign-out-btn').addEventListener('click', () => sb.auth.signOut());

// ── Navigation ─────────────────────────────────────────────────────────────
function navigateTo(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.style.display = p.id === `tab-${tab}` ? 'block' : 'none';
  });
  switch (tab) {
    case 'queue':   loadQueue();   break;
    case 'puzzles': loadPuzzles(); break;
    case 'users':   loadUsers();   break;
    case 'support': loadSupport(); break;
  }
}

document.querySelectorAll('.nav-item').forEach(n => {
  n.addEventListener('click', () => navigateTo(n.dataset.tab));
});

// ── Tab: Queue ─────────────────────────────────────────────────────────────
let queueData = [];

async function loadQueue() {
  const container = $('queue-container');
  container.innerHTML = '<div class="spinner"></div>';

  const { data, error } = await sb
    .from('puzzles')
    .select('*, profiles(username)')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });

  if (error) { container.innerHTML = `<p style="color:var(--red);padding:20px">${error.message}</p>`; return; }

  queueData = data;
  queueBadge = data.length;
  $('queue-badge').textContent = data.length > 0 ? data.length : '';
  $('queue-badge').style.display = data.length > 0 ? 'inline' : 'none';

  if (!data.length) {
    container.innerHTML = '';
    const es = el('div', 'empty-state');
    es.innerHTML = '<div class="empty-state__icon">✅</div><div class="empty-state__title">Queue is clear</div><div class="empty-state__body">No puzzles waiting for review.</div>';
    container.appendChild(es);
    return;
  }

  container.innerHTML = '';
  const grid = el('div', 'queue-grid');
  data.forEach(p => grid.appendChild(buildQueueCard(p)));
  container.appendChild(grid);
}

function buildQueueCard(p) {
  const card = el('div', 'queue-card');
  const submitter = p.profiles?.username || 'Unknown';
  const photos = puzzleImages(p);

  card.innerHTML = `
    <div class="queue-card__header">
      <div>
        <div class="queue-card__title">${esc(p.title || 'Untitled')}</div>
        <div class="queue-card__meta">${esc(p.brand || '—')} · ${p.piece_count || '?'} pc · ${esc(p.difficulty || '?')}</div>
      </div>
      <span class="queue-card__submitter">by ${esc(submitter)}</span>
    </div>
    <div class="queue-card__photos" id="photos-${p.id}"></div>
    <div class="queue-card__actions">
      <button class="btn btn--approve" onclick="approveQueuePuzzle('${p.id}', this)">✓ Approve</button>
      <button class="btn btn--danger"  onclick="rejectQueuePuzzle('${p.id}', this)">✕ Reject</button>
      <button class="btn btn--ghost"   onclick="openPuzzleEdit('${p.id}')">🖼 Edit pictures</button>
    </div>
  `;

  const photosRow = card.querySelector(`#photos-${p.id}`);
  if (photos.length) {
    photos.slice(0, 6).forEach(url => {
      const img = el('img', 'queue-card__photo');
      img.src = url; img.alt = '';
      photosRow.appendChild(img);
    });
  } else {
    const ph = el('div', 'queue-card__photo-placeholder', '📦');
    photosRow.appendChild(ph);
  }

  return card;
}

async function approveQueuePuzzle(id, btn) {
  btn.disabled = true; btn.textContent = 'Approving…';
  const { error } = await sb.from('puzzles').update({ status: 'published' }).eq('id', id);
  if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '✓ Approve'; return; }
  showToast('Puzzle approved and published.');
  loadQueue();
}

async function rejectQueuePuzzle(id, btn) {
  if (!confirm('Reject this puzzle submission? It will be marked private and hidden from all users.')) return;
  btn.disabled = true; btn.textContent = 'Rejecting…';
  const { error } = await sb.from('puzzles').update({ status: 'private' }).eq('id', id);
  if (error) { showToast(error.message, 'error'); btn.disabled = false; btn.textContent = '✕ Reject'; return; }
  showToast('Puzzle rejected.');
  loadQueue();
}

// ── Tab: Puzzles ───────────────────────────────────────────────────────────
let puzzlesData = [];
let puzzlesSearch = '';

async function loadPuzzles() {
  const tbody = $('puzzles-tbody');
  tbody.innerHTML = '<tr><td colspan="8"><div class="spinner"></div></td></tr>';

  const { data, error } = await sb
    .from('puzzles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) { tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red);padding:16px">${error.message}</td></tr>`; return; }
  puzzlesData = data;
  renderPuzzlesTable();
}

function renderPuzzlesTable() {
  const tbody = $('puzzles-tbody');
  const q = puzzlesSearch.toLowerCase();
  const filtered = puzzlesData.filter(p =>
    !q || (p.title || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q)
  );

  tbody.innerHTML = '';
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--ink3);">No puzzles found.</td></tr>';
    return;
  }

  filtered.forEach(p => {
    const tr = el('tr');
    const photos = puzzleImages(p);
    const thumb = photos.length
      ? `<img class="thumb" src="${esc(photos[0])}" alt="" loading="lazy">
         ${photos.length > 1 ? `<div class="thumb__count">+${photos.length - 1}</div>` : ''}`
      : '<div class="thumb thumb--empty">📦</div>';
    tr.innerHTML = `
      <td>${thumb}</td>
      <td><strong>${esc(p.title || '—')}</strong></td>
      <td>${esc(p.brand || '—')}</td>
      <td>${p.piece_count || '—'}</td>
      <td>${esc(p.difficulty || '—')}</td>
      <td><span class="badge badge--${p.status === 'published' ? 'pub' : 'pending'}">${esc(p.status || '—')}</span></td>
      <td>
        <label class="toggle" title="Toggle featured">
          <input type="checkbox" ${p.featured ? 'checked' : ''} onchange="toggleFeatured('${p.id}', this)">
          <span class="toggle__track"></span>
          <span class="toggle__thumb"></span>
        </label>
      </td>
      <td><button class="btn btn--ghost btn--sm" onclick="openPuzzleEdit('${p.id}')">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });
}

$('puzzles-search').addEventListener('input', e => {
  puzzlesSearch = e.target.value;
  renderPuzzlesTable();
});

async function toggleFeatured(id, checkbox) {
  const featured = checkbox.checked;
  const { error } = await sb.from('puzzles').update({ featured }).eq('id', id);
  if (error) {
    showToast(error.message, 'error');
    checkbox.checked = !featured;
    return;
  }
  const p = puzzlesData.find(x => x.id === id);
  if (p) p.featured = featured;
  showToast(featured ? 'Marked as featured.' : 'Removed from featured.');
}

// ── Puzzle pictures ────────────────────────────────────────────────────────
// Pictures live in `image_urls` (ordered, first one is the cover). Older rows
// may only carry the single legacy `image_url`, so both are read and written.
function puzzleImages(p) {
  if (!p) return [];
  const list = Array.isArray(p.image_urls) ? p.image_urls : (p.image_urls ? [p.image_urls] : []);
  const all = list.length ? list : (p.image_url ? [p.image_url] : []);
  return all.filter(u => typeof u === 'string' && u.trim()).map(u => u.trim());
}

let detectedBucket = null;

// Storage URLs look like …/storage/v1/object/public/<bucket>/<path>, so the
// bucket the app already uploads to can be read straight off an existing picture.
function bucketFromStorageUrl(url) {
  const m = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?([^/?#]+)\//.exec(String(url || ''));
  return m ? m[1] : null;
}

function puzzleImageBucket() {
  if (detectedBucket) return detectedBucket;
  for (const p of [...puzzlesData, ...queueData]) {
    for (const url of puzzleImages(p)) {
      const bucket = bucketFromStorageUrl(url);
      if (bucket) { detectedBucket = bucket; return bucket; }
    }
  }
  return FALLBACK_IMAGE_BUCKET;
}

// Writes the update, retrying without any column PostgREST reports as unknown
// (e.g. a schema that never had the legacy `image_url`).
async function updatePuzzleRow(id, updates) {
  let payload = { ...updates };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await sb.from('puzzles').update(payload).eq('id', id);
    if (!error) return { updates: payload, error: null };
    const missing = error.code === 'PGRST204' && /'([^']+)' column/.exec(error.message || '');
    if (!missing || !(missing[1] in payload)) return { updates: payload, error };
    delete payload[missing[1]];
    if (!Object.keys(payload).length) return { updates: payload, error };
  }
  return { updates: payload, error: null };
}

// Draft picture list for the open modal: { url, bucket, path, uploading }.
let photoDraft = [];
let sessionUploads = [];   // uploaded in this modal session, for cleanup on cancel
let uploadsInFlight = 0;

function renderPhotoEditor() {
  const wrap = $('edit-photos');
  wrap.innerHTML = '';

  const existingEmpty = wrap.parentNode.querySelector('.photo-empty');
  if (existingEmpty) existingEmpty.remove();
  if (!photoDraft.length) {
    wrap.insertAdjacentElement('beforebegin', el('div', 'photo-empty', 'No pictures yet — upload one or paste an image URL.'));
  }

  photoDraft.forEach((photo, i) => {
    const tile = el('div', 'photo-tile' + (i === 0 ? ' photo-tile--cover' : '') + (photo.uploading ? ' photo-tile--uploading' : ''));

    const img = el('img', 'photo-tile__img');
    img.src = photo.url;
    img.alt = '';
    img.loading = 'lazy';
    tile.appendChild(img);

    if (photo.uploading) {
      tile.appendChild(el('div', 'photo-tile__spinner'));
    } else {
      if (i === 0) tile.appendChild(el('span', 'photo-tile__badge', 'Cover'));

      const remove = el('button', 'photo-tile__remove', '✕');
      remove.type = 'button';
      remove.title = 'Remove picture';
      remove.addEventListener('click', () => removePhoto(i));
      tile.appendChild(remove);

      const bar = el('div', 'photo-tile__bar');
      bar.appendChild(photoBarButton('‹', 'Move earlier', i === 0, () => movePhoto(i, -1)));
      bar.appendChild(photoBarButton('★', 'Make cover', i === 0, () => movePhoto(i, -i)));
      bar.appendChild(photoBarButton('›', 'Move later', i === photoDraft.length - 1, () => movePhoto(i, 1)));
      tile.appendChild(bar);
    }

    wrap.appendChild(tile);
  });

  $('puzzle-modal').querySelector('button[type="submit"]').disabled = uploadsInFlight > 0;
}

function photoBarButton(label, title, disabled, onClick) {
  const b = el('button', 'photo-tile__btn', label);
  b.type = 'button';
  b.title = title;
  b.disabled = disabled;
  if (!disabled) b.addEventListener('click', onClick);
  return b;
}

function movePhoto(i, delta) {
  const target = i + delta;
  if (target < 0 || target >= photoDraft.length) return;
  const [photo] = photoDraft.splice(i, 1);
  photoDraft.splice(target, 0, photo);
  renderPhotoEditor();
}

function removePhoto(i) {
  photoDraft.splice(i, 1);
  renderPhotoEditor();
}

function addPhotoUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return false;
  if (!/^https?:\/\//i.test(trimmed)) { showToast('Enter a full image URL starting with http.', 'error'); return false; }
  if (photoDraft.some(ph => ph.url === trimmed)) { showToast('That picture is already attached.', 'error'); return false; }
  photoDraft.push({ url: trimmed });
  renderPhotoEditor();
  return true;
}

async function uploadPhotoFile(file, puzzleId) {
  const bucket = puzzleImageBucket();
  const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${puzzleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, bucket, path };
}

async function handlePhotoFiles(files) {
  const puzzleId = $('edit-puzzle-id').value;
  if (!puzzleId) return;

  for (const file of files) {
    if (!file.type.startsWith('image/')) { showToast(`${file.name} is not an image.`, 'error'); continue; }
    if (file.size > MAX_IMAGE_BYTES) { showToast(`${file.name} is larger than 10 MB.`, 'error'); continue; }

    const placeholder = { url: URL.createObjectURL(file), uploading: true };
    photoDraft.push(placeholder);
    uploadsInFlight++;
    renderPhotoEditor();

    try {
      const uploaded = await uploadPhotoFile(file, puzzleId);
      URL.revokeObjectURL(placeholder.url);
      Object.assign(placeholder, uploaded, { uploading: false });
      sessionUploads.push({ bucket: uploaded.bucket, path: uploaded.path });
    } catch (err) {
      URL.revokeObjectURL(placeholder.url);
      const idx = photoDraft.indexOf(placeholder);
      if (idx !== -1) photoDraft.splice(idx, 1);
      const msg = /bucket not found/i.test(err.message || '')
        ? `Storage bucket "${puzzleImageBucket()}" not found — check the bucket name in admin.js.`
        : `Upload failed: ${err.message || err}`;
      showToast(msg, 'error');
    } finally {
      uploadsInFlight--;
      renderPhotoEditor();
    }
  }
}

// Removes files uploaded in this modal session that ended up unused.
async function discardUnusedUploads(keepUrls) {
  const kept = new Set(keepUrls || []);
  const orphans = sessionUploads.filter(u => !photoDraft.some(ph => ph.path === u.path && kept.has(ph.url)));
  sessionUploads = [];
  const byBucket = {};
  orphans.forEach(o => { (byBucket[o.bucket] = byBucket[o.bucket] || []).push(o.path); });
  for (const [bucket, paths] of Object.entries(byBucket)) {
    await sb.storage.from(bucket).remove(paths);
  }
}

$('photo-upload-btn').addEventListener('click', () => $('photo-file-input').click());

$('photo-file-input').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  await handlePhotoFiles(files);
});

$('photo-url-btn').addEventListener('click', () => {
  if (addPhotoUrl($('photo-url-input').value)) $('photo-url-input').value = '';
});

$('photo-url-input').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (addPhotoUrl(e.target.value)) e.target.value = '';
});

// ── Puzzle edit modal ──────────────────────────────────────────────────────
function findPuzzle(id) {
  return puzzlesData.find(x => x.id === id) || queueData.find(x => x.id === id) || null;
}

async function openPuzzleEdit(id) {
  const p = findPuzzle(id);
  if (!p) return;
  $('edit-puzzle-id').value = p.id;
  $('edit-title').value = p.title || '';
  $('edit-brand').value = p.brand || '';
  $('edit-piece-count').value = p.piece_count || '';
  $('edit-difficulty').value = p.difficulty || 'medium';
  $('edit-status').value = p.status || 'published';

  photoDraft = puzzleImages(p).map(url => ({ url, bucket: bucketFromStorageUrl(url), path: null }));
  sessionUploads = [];
  uploadsInFlight = 0;
  $('photo-url-input').value = '';
  renderPhotoEditor();

  $('puzzle-modal').classList.add('open');
}

$('puzzle-edit-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (uploadsInFlight > 0) { showToast('Wait for uploads to finish.', 'error'); return; }

  const id = $('edit-puzzle-id').value;
  const imageUrls = photoDraft.filter(ph => !ph.uploading).map(ph => ph.url);
  const updates = {
    title:       $('edit-title').value.trim(),
    brand:       $('edit-brand').value.trim(),
    piece_count: parseInt($('edit-piece-count').value) || null,
    difficulty:  $('edit-difficulty').value,
    status:      $('edit-status').value,
    image_urls:  imageUrls,
    image_url:   imageUrls[0] || null,
  };

  const { updates: applied, error } = await updatePuzzleRow(id, updates);
  if (error) { showToast(error.message, 'error'); return; }

  await discardUnusedUploads(imageUrls);

  [puzzlesData, queueData].forEach(list => {
    const p = list.find(x => x.id === id);
    if (p) Object.assign(p, applied);
  });

  closePuzzleModal();
  renderPuzzlesTable();
  if (currentTab === 'queue') loadQueue();
  showToast('Puzzle saved.');
});

async function closePuzzleModal() {
  $('puzzle-modal').classList.remove('open');
  photoDraft.filter(ph => ph.uploading).forEach(ph => URL.revokeObjectURL(ph.url));
  photoDraft = [];
  uploadsInFlight = 0;
  await discardUnusedUploads([]);
}

$('puzzle-modal-close').addEventListener('click', closePuzzleModal);
$('puzzle-modal-cancel').addEventListener('click', closePuzzleModal);
$('puzzle-modal').addEventListener('click', e => { if (e.target === $('puzzle-modal')) closePuzzleModal(); });

// ── Tab: Users ─────────────────────────────────────────────────────────────
let usersData = [];
let usersSearch = '';

async function loadUsers() {
  const tbody = $('users-tbody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="spinner"></div></td></tr>';

  const { data, error } = await sb
    .from('profiles')
    .select('id, username, display_name, is_admin, created_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) { tbody.innerHTML = `<tr><td colspan="5" style="color:var(--red);padding:16px">${error.message}</td></tr>`; return; }
  usersData = data;
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = $('users-tbody');
  const q = usersSearch.toLowerCase();
  const filtered = usersData.filter(u =>
    !q || (u.username || '').toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q)
  );

  tbody.innerHTML = '';
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--ink3);">No users found.</td></tr>';
    return;
  }

  filtered.forEach(u => {
    const tr = el('tr');
    tr.innerHTML = `
      <td><strong>${esc(u.username || '—')}</strong></td>
      <td>${esc(u.display_name || '—')}</td>
      <td><span class="badge badge--${u.is_admin ? 'admin' : 'user'}">${u.is_admin ? 'Admin' : 'User'}</span></td>
      <td>${fmtDate(u.created_at)}</td>
      <td>
        <label class="toggle" title="Toggle admin">
          <input type="checkbox" ${u.is_admin ? 'checked' : ''} onchange="toggleAdmin('${u.id}', this, '${esc(u.username || u.id)}')">
          <span class="toggle__track"></span>
          <span class="toggle__thumb"></span>
        </label>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

$('users-search').addEventListener('input', e => {
  usersSearch = e.target.value;
  renderUsersTable();
});

async function toggleAdmin(id, checkbox, username) {
  const isAdmin = checkbox.checked;
  const verb = isAdmin ? 'grant admin to' : 'remove admin from';
  if (!confirm(`Are you sure you want to ${verb} @${username}?`)) {
    checkbox.checked = !isAdmin;
    return;
  }
  const { error } = await sb.from('profiles').update({ is_admin: isAdmin }).eq('id', id);
  if (error) {
    showToast(error.message, 'error');
    checkbox.checked = !isAdmin;
    return;
  }
  const u = usersData.find(x => x.id === id);
  if (u) u.is_admin = isAdmin;
  renderUsersTable();
  showToast(isAdmin ? `Admin granted to @${username}.` : `Admin removed from @${username}.`);
}

// ── Tab: Support ───────────────────────────────────────────────────────────
let supportData = [];
let supportFilter = 'open';
let selectedTicket = null;

async function loadSupport() {
  const container = $('support-list');
  container.innerHTML = '<div class="spinner"></div>';
  $('support-detail').style.display = 'none';

  let query = sb
    .from('support_tickets')
    .select('*, profiles(username, display_name)')
    .order('created_at', { ascending: false })
    .limit(200);

  if (supportFilter !== 'all') query = query.eq('status', supportFilter);

  const { data, error } = await query;
  if (error) { container.innerHTML = `<p style="color:var(--red);padding:20px">${error.message}</p>`; return; }
  supportData = data;
  renderSupportList();
}

function renderSupportList() {
  const container = $('support-list');
  container.innerHTML = '';

  if (!supportData.length) {
    const es = el('div', 'empty-state');
    es.innerHTML = `<div class="empty-state__icon">📭</div><div class="empty-state__title">No tickets</div><div class="empty-state__body">No support tickets matching this filter.</div>`;
    container.appendChild(es);
    return;
  }

  const table = el('div', 'table-wrap');
  const t = el('table');
  t.innerHTML = `<thead><tr><th>Subject</th><th>From</th><th>Type</th><th>Status</th><th>Date</th></tr></thead>`;
  const tbody = el('tbody');

  supportData.forEach(ticket => {
    const tr = el('tr');
    tr.innerHTML = `
      <td><strong>${esc(ticket.subject || '—')}</strong></td>
      <td>${esc(ticket.profiles?.username || '—')}</td>
      <td><span class="badge badge--pending">${esc(ticket.type || 'support')}</span></td>
      <td><span class="badge badge--${ticket.status === 'open' ? 'open' : ticket.status === 'in_progress' ? 'progress' : 'resolved'}">${esc(ticket.status)}</span></td>
      <td>${fmtDate(ticket.created_at)}</td>
    `;
    tr.addEventListener('click', () => openTicket(ticket));
    tbody.appendChild(tr);
  });

  t.appendChild(tbody);
  table.appendChild(t);
  container.appendChild(table);
}

$('support-filter').addEventListener('change', e => {
  supportFilter = e.target.value;
  loadSupport();
});

function openTicket(ticket) {
  selectedTicket = ticket;
  $('ticket-subject').textContent = ticket.subject || '—';
  $('ticket-from').textContent    = ticket.profiles?.username || '—';
  $('ticket-type').textContent    = ticket.type || 'support';
  $('ticket-date').textContent    = fmtDate(ticket.created_at);
  $('ticket-body').textContent    = ticket.body || '';
  $('ticket-note').value          = ticket.admin_note || '';
  $('ticket-status').value        = ticket.status || 'open';
  $('support-detail').style.display = 'block';
  $('support-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('ticket-save-btn').addEventListener('click', async () => {
  if (!selectedTicket) return;
  const status    = $('ticket-status').value;
  const adminNote = $('ticket-note').value.trim();
  const updates   = { status, admin_note: adminNote || null };
  if (status === 'resolved' && selectedTicket.status !== 'resolved') {
    updates.resolved_at = new Date().toISOString();
    const { data: { user } } = await sb.auth.getUser();
    updates.resolved_by = user?.id || null;
  }

  const { error } = await sb.from('support_tickets').update(updates).eq('id', selectedTicket.id);
  if (error) { showToast(error.message, 'error'); return; }
  Object.assign(selectedTicket, updates);

  const idx = supportData.findIndex(t => t.id === selectedTicket.id);
  if (idx !== -1) Object.assign(supportData[idx], updates);
  renderSupportList();
  showToast('Ticket updated.');
});

$('ticket-close-btn').addEventListener('click', () => {
  $('support-detail').style.display = 'none';
  selectedTicket = null;
});

// ── Utilities ──────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────
init();
