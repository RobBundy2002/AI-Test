const KEY = 'sermonwise.library.v1';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const load = () => { try { const x = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(x) ? x : []; } catch { return []; } };
let sermons = [];
let favoritesOnly = false;
let currentUser = null;
let authMode = 'login';
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function refreshLibrary() { sermons = (await api('/api/sermons')).sermons; render(); }
const dateLabel = value => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function render() {
  const query = $('#search').value.trim().toLowerCase();
  const speaker = $('#speaker-filter').value;
  const series = $('#series-filter').value;
  const speakers = [...new Set(sermons.map(x => x.speaker).filter(Boolean))].sort();
  const seriesNames = [...new Set(sermons.map(x => x.series).filter(Boolean))].sort();
  $('#speaker-filter').innerHTML = '<option value="">All speakers</option>' + speakers.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  $('#series-filter').innerHTML = '<option value="">All series</option>' + seriesNames.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  $('#speaker-filter').value = speaker;
  $('#series-filter').value = series;
  const filtered = sermons.filter(x => (!favoritesOnly || x.favorite) && (!speaker || x.speaker === speaker) && (!series || x.series === series) && (!query || [x.title, x.speaker, x.series, x.passage, ...(x.topics || []), x.notes?.summary, x.transcript].join(' ').toLowerCase().includes(query)));
  $('#collection-title').firstChild.textContent = favoritesOnly ? 'Favorites ' : 'Sermon library ';
  $('#count').textContent = filtered.length;
  $('#empty-state').hidden = sermons.length > 0 || favoritesOnly || !!query || !!speaker || !!series;
  $('#sermon-list').innerHTML = filtered.map(x => `<article class="sermon-card" data-id="${escapeHtml(x.id)}"><button class="card-image" data-open="${escapeHtml(x.id)}" aria-label="Open ${escapeHtml(x.title)}"><img src="${escapeHtml(x.thumbnail)}" alt="" loading="lazy"><span class="play-icon">▶</span></button><div class="card-body"><div class="card-meta"><span>${escapeHtml(x.series || 'SERMON')}</span><button class="favorite ${x.favorite ? 'is-favorite' : ''}" data-favorite="${escapeHtml(x.id)}" aria-label="${x.favorite ? 'Remove from favorites' : 'Add to favorites'}">${x.favorite ? '♥' : '♡'}</button></div><button class="card-title" data-open="${escapeHtml(x.id)}">${escapeHtml(x.title)}</button><p class="card-summary">${escapeHtml(x.notes?.summary || '').slice(0, 135)}${(x.notes?.summary || '').length > 135 ? '…' : ''}</p><div class="card-tags">${x.passage ? `<span>${escapeHtml(x.passage)}</span>` : ''}${(x.topics || []).slice(0, 2).map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div><div class="card-footer"><span>${escapeHtml(x.speaker || 'Unknown speaker')}</span><span>${dateLabel(x.createdAt)}</span></div></div></article>`).join('');
  if (!filtered.length && sermons.length && !$('#empty-state').hidden) $('#empty-state').hidden = true;
  if (!filtered.length && sermons.length) $('#sermon-list').innerHTML = '<div class="no-results">No sermons match your search.</div>';
}

function openAdd() { if (!currentUser) { $('#auth-dialog').showModal(); return; } $('#form-message').textContent = ''; $('#add-dialog').showModal(); }
['#add-hero', '#add-side', '#add-empty'].forEach(s => $(s).addEventListener('click', openAdd));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => el.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(el => el.addEventListener('click', event => { if (event.target === el) el.close(); }));
['#search', '#speaker-filter', '#series-filter'].forEach(s => $(s).addEventListener(s === '#search' ? 'input' : 'change', render));
$('#nav-library').addEventListener('click', () => { favoritesOnly = false; $('#nav-library').classList.add('active'); $('#nav-favorites').classList.remove('active'); render(); });
$('#nav-favorites').addEventListener('click', () => { favoritesOnly = true; $('#nav-favorites').classList.add('active'); $('#nav-library').classList.remove('active'); render(); });

$('#add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const button = $('#submit-button');
  button.disabled = true;
  button.textContent = 'Creating your study notes…';
  $('#form-message').textContent = 'This may take a few minutes if audio transcription is needed.';
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: data.url, transcript: data.transcript }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create notes.');
    const draft = { url: `https://www.youtube.com/watch?v=${result.videoId}`, videoId: result.videoId, title: result.title, speaker: data.speaker.trim() || result.speaker, series: data.series.trim(), passage: data.passage.trim() || result.notes.passages?.[0] || '', topics: data.topics.split(',').map(x => x.trim()).filter(Boolean), transcript: result.transcript, source: result.source, notes: result.notes };
    const sermon = (await api('/api/sermons', { method: 'POST', body: JSON.stringify(draft) })).sermon;
    sermons.unshift(sermon); render(); form.reset(); $('#add-dialog').close(); openDetail(sermon.id);
  } catch (error) { $('#form-message').textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'Create study notes <span>→</span>'; }
});

function openDetail(sermonId) {
  const x = sermons.find(item => item.id === sermonId);
  if (!x) return;
  $('#detail-content').innerHTML = `<div class="detail-top"><button class="back-button" data-detail-close>← Back to library</button><button class="favorite ${x.favorite ? 'is-favorite' : ''}" data-favorite="${escapeHtml(x.id)}" aria-label="Toggle favorite">${x.favorite ? '♥' : '♡'}</button></div><div class="detail-hero"><div class="eyebrow muted">${escapeHtml(x.series || 'SERMON NOTES')}</div><h2>${escapeHtml(x.title)}</h2><p>${escapeHtml(x.speaker || 'Unknown speaker')} <span>·</span> ${dateLabel(x.createdAt)}</p><div class="detail-tags">${x.passage ? `<span>${escapeHtml(x.passage)}</span>` : ''}${(x.topics || []).map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div></div><div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(x.videoId)}" title="${escapeHtml(x.title)}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div><div class="detail-note"><span class="note-icon">✦</span><div><small>THE MESSAGE IN A MOMENT</small><p>${escapeHtml(x.notes?.summary || '')}</p></div></div><div class="detail-columns"><section><h3>Key takeaways</h3><ol class="takeaways">${(x.notes?.takeaways || []).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol></section><section><h3>Moments to remember</h3><div class="highlights">${(x.notes?.highlights || []).map(t => `<blockquote>“${escapeHtml(t)}”</blockquote>`).join('')}</div></section></div><section class="reflection-panel"><h3>My reflections</h3><p>What stood out, and how will you put it into practice?</p><textarea id="reflection" maxlength="5000" rows="5" placeholder="Write your own thoughts here...">${escapeHtml(x.reflection || '')}</textarea><button class="side-add" data-save-reflection="${escapeHtml(x.id)}">Save reflection</button><span id="reflection-status" role="status"></span></section><details class="transcript-panel"><summary>Read full transcript <span>⌄</span></summary><p>${escapeHtml(x.transcript)}</p></details><div class="detail-bottom"><small>Notes: ${x.notes?.mode === 'ai' ? 'AI-assisted' : 'Extractive'} · Transcript: ${escapeHtml(x.source)}. Verify against the original sermon.</small><button class="delete-button" data-delete="${escapeHtml(x.id)}">Remove sermon</button></div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

document.addEventListener('click', async event => {
  const open = event.target.closest('[data-open]');
  const favorite = event.target.closest('[data-favorite]');
  const remove = event.target.closest('[data-delete]');
  const saveReflection = event.target.closest('[data-save-reflection]');
  if (open) openDetail(open.dataset.open);
  if (favorite) { const x = sermons.find(item => item.id === favorite.dataset.favorite); if (x) { try { const result = await api(`/api/sermons/${x.id}`, { method: 'PATCH', body: JSON.stringify({ favorite: !x.favorite }) }); Object.assign(x, result.sermon); render(); if ($('#detail-dialog').open) openDetail(x.id); } catch (error) { alert(error.message); } } }
  if (remove && confirm('Remove this sermon from your library?')) { try { await api(`/api/sermons/${remove.dataset.delete}`, { method: 'DELETE' }); sermons = sermons.filter(x => x.id !== remove.dataset.delete); $('#detail-dialog').close(); render(); } catch (error) { alert(error.message); } }
  if (saveReflection) { try { const result = await api(`/api/sermons/${saveReflection.dataset.saveReflection}`, { method: 'PATCH', body: JSON.stringify({ reflection: $('#reflection').value }) }); const x = sermons.find(item => item.id === result.sermon.id); if (x) Object.assign(x, result.sermon); $('#reflection-status').textContent = 'Saved'; } catch (error) { $('#reflection-status').textContent = error.message; } }
  if (event.target.closest('[data-detail-close]')) $('#detail-dialog').close();
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, sermons }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'sermonwise-library.json'; a.click(); URL.revokeObjectURL(url);
});
$('#import').addEventListener('change', async event => {
  try {
    const data = JSON.parse(await event.target.files[0].text());
    if (!Array.isArray(data.sermons) || data.version !== 1) throw new Error('Invalid library file.');
    const incoming = data.sermons.filter(x => x && typeof x.title === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(x.videoId) && typeof x.transcript === 'string' && x.notes && typeof x.notes.summary === 'string').slice(0, 500);
    for (const sermon of incoming) await api('/api/sermons', { method: 'POST', body: JSON.stringify(sermon) });
    await refreshLibrary();
  } catch (error) { alert(error.message || 'Could not import library.'); }
  event.target.value = '';
});
function showAuth(mode = 'login') {
  authMode = mode;
  $('#auth-title').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
  $('#auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('#auth-switch').textContent = mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in';
  $('#auth-form').elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-message').textContent = '';
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}
async function importOldLibrary() {
  const old = load();
  if (!old.length || !confirm(`Import ${old.length} sermon${old.length === 1 ? '' : 's'} saved in this browser into your account?`)) return;
  for (const sermon of old) await api('/api/sermons', { method: 'POST', body: JSON.stringify(sermon) });
  localStorage.removeItem(KEY);
  await refreshLibrary();
}
$('#auth-switch').addEventListener('click', () => showAuth(authMode === 'login' ? 'register' : 'login'));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('#auth-submit');
  button.disabled = true;
  try {
    const result = await api(authMode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    currentUser = result.user;
    $('#account-email').textContent = currentUser.email;
    $('#logout').hidden = false;
    $('#auth-dialog').close();
    form.reset();
    await refreshLibrary();
    await importOldLibrary();
  } catch (error) { $('#auth-message').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  currentUser = null; sermons = []; $('#account-email').textContent = 'Sign in to sync'; $('#logout').hidden = true; render(); showAuth();
});
async function init() {
  try {
    const result = await api('/api/me');
    if (result.user) { currentUser = result.user; $('#account-email').textContent = currentUser.email; $('#logout').hidden = false; await refreshLibrary(); await importOldLibrary(); }
    else showAuth();
  } catch { showAuth(); }
}
render();
init();
