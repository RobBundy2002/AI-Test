const KEY = 'sermonwise.library.v1';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const loadOldLibrary = () => { try { const value = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(value) ? value : []; } catch { return []; } };

let sermons = [];
let favoritesOnly = false;
let currentUser = null;
let authMode = 'login';
let viewMode = localStorage.getItem('sermonwise.view') || 'grid';
let inviteRequired = false;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const uniqueSorted = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function setOptions(selector, values, label, selected) {
  const el = $(selector);
  el.innerHTML = `<option value="">${label}</option>` + values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  el.value = values.includes(selected) ? selected : '';
}

function stats() {
  const passages = new Set(sermons.flatMap(item => [item.passage, ...(item.notes?.passages || [])].filter(Boolean)));
  return {
    total: sermons.length,
    favorites: sermons.filter(item => item.favorite).length,
    ai: sermons.filter(item => item.notes?.mode === 'ai').length,
    passages: passages.size
  };
}

function filteredSermons() {
  const query = $('#search').value.trim().toLowerCase();
  const speaker = $('#speaker-filter').value;
  const series = $('#series-filter').value;
  const topic = $('#topic-filter').value;
  const source = $('#source-filter').value;
  const sort = $('#sort-select').value;
  const filtered = sermons.filter(item => {
    const haystack = [item.title, item.speaker, item.series, item.passage, item.source, ...(item.topics || []), ...(item.notes?.keywords || []), item.notes?.summary, item.transcript].join(' ').toLowerCase();
    return (!favoritesOnly || item.favorite)
      && (!speaker || item.speaker === speaker)
      && (!series || item.series === series)
      && (!topic || (item.topics || []).includes(topic) || (item.notes?.keywords || []).includes(topic))
      && (!source || item.source === source)
      && (!query || haystack.includes(query));
  });
  return filtered.sort((a, b) => {
    if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (sort === 'title') return String(a.title).localeCompare(String(b.title));
    if (sort === 'speaker') return String(a.speaker || '').localeCompare(String(b.speaker || '')) || String(a.title).localeCompare(String(b.title));
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function updateMetrics() {
  const values = stats();
  $('#metric-total').textContent = values.total;
  $('#metric-favorites').textContent = values.favorites;
  $('#metric-ai').textContent = values.ai;
  $('#metric-passages').textContent = values.passages;
  $('#nav-library-count').textContent = values.total;
  $('#nav-favorite-count').textContent = values.favorites;
}

function render() {
  const selected = {
    speaker: $('#speaker-filter').value,
    series: $('#series-filter').value,
    topic: $('#topic-filter').value
  };
  setOptions('#speaker-filter', uniqueSorted(sermons.map(item => item.speaker)), 'All speakers', selected.speaker);
  setOptions('#series-filter', uniqueSorted(sermons.map(item => item.series)), 'All series', selected.series);
  setOptions('#topic-filter', uniqueSorted(sermons.flatMap(item => [...(item.topics || []), ...(item.notes?.keywords || [])])), 'All topics', selected.topic);
  updateMetrics();

  const filtered = filteredSermons();
  $('#collection-title').firstChild.textContent = favoritesOnly ? 'Favorites ' : 'All sermons ';
  $('#count').textContent = filtered.length;
  $('#sermon-list').className = viewMode === 'list' ? 'sermon-list list-mode' : 'sermon-grid';
  $('#grid-view').classList.toggle('selected', viewMode === 'grid');
  $('#list-view').classList.toggle('selected', viewMode === 'list');
  $('#empty-state').hidden = sermons.length > 0 || favoritesOnly || hasFilters();

  if (!filtered.length && sermons.length) {
    $('#sermon-list').innerHTML = '<div class="no-results">No sermons match the current filters.</div>';
    return;
  }
  $('#sermon-list').innerHTML = filtered.map(cardTemplate).join('');
}

function hasFilters() {
  return Boolean($('#search').value.trim() || $('#speaker-filter').value || $('#series-filter').value || $('#topic-filter').value || $('#source-filter').value);
}

function cardTemplate(item) {
  const topics = [...(item.topics || []), ...(item.notes?.keywords || [])].filter(Boolean);
  const badges = [item.passage, ...topics].filter(Boolean).slice(0, 4).map(tag => `<span>${escapeHtml(tag)}</span>`).join('');
  const metaLabel = item.series || (item.notes?.mode === 'ai' ? 'AI notes' : 'Study notes');
  return `<article class="sermon-card ${item.favorite ? 'is-saved' : ''}" data-id="${escapeHtml(item.id)}">
    <button class="card-image" data-open="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.title)}">
      <img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy">
      <span class="source-chip">${escapeHtml(item.source || 'pasted')}</span>
    </button>
    <div class="card-body">
      <div class="card-meta">
        <span>${escapeHtml(metaLabel)}</span>
        <button class="favorite ${item.favorite ? 'is-favorite' : ''}" data-favorite="${escapeHtml(item.id)}" aria-label="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">${item.favorite ? 'Saved' : 'Save'}</button>
      </div>
      <button class="card-title" data-open="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button>
      <p class="card-summary">${escapeHtml(item.notes?.summary || '').slice(0, 170)}${(item.notes?.summary || '').length > 170 ? '...' : ''}</p>
      <div class="card-tags">${badges}</div>
      <div class="card-footer"><span>${escapeHtml(item.speaker || 'Unknown speaker')}</span><span>${dateLabel(item.createdAt)}</span></div>
    </div>
  </article>`;
}

function openAdd() {
  if (!currentUser) {
    showAuth();
    return;
  }
  $('#form-message').textContent = '';
  $('#add-dialog').showModal();
}

async function refreshLibrary() {
  sermons = (await api('/api/sermons')).sermons;
  render();
}

function markdownFor(item) {
  const lines = [
    `# ${item.title}`,
    '',
    `- Speaker: ${item.speaker || 'Unknown speaker'}`,
    `- Series: ${item.series || 'None'}`,
    `- Date saved: ${dateLabel(item.createdAt)}`,
    `- Source: ${item.url}`,
    '',
    '## Summary',
    item.notes?.summary || '',
    '',
    '## Key Takeaways',
    ...(item.notes?.takeaways || []).map(text => `- ${text}`),
    '',
    '## Outline',
    ...(item.notes?.outline || []).map(point => `- ${point.title}: ${point.point}`),
    '',
    '## Discussion Questions',
    ...(item.notes?.questions || []).map(text => `- ${text}`),
    '',
    '## Prayer',
    item.notes?.prayer || '',
    '',
    '## Personal Reflection',
    item.reflection || '',
    '',
    '## Transcript',
    item.transcript || ''
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function downloadText(name, text, type = 'text/markdown') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value) {
  return String(value || 'sermon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'sermon';
}

function openDetail(sermonId) {
  const item = sermons.find(x => x.id === sermonId);
  if (!item) return;
  const notes = item.notes || {};
  $('#detail-content').innerHTML = `<div class="detail-shell">
    <div class="detail-top">
      <button class="back-button" data-detail-close type="button">Back to library</button>
      <div class="detail-actions">
        <button class="ghost-button" data-copy-markdown="${escapeHtml(item.id)}" type="button">Copy notes</button>
        <button class="ghost-button" data-download-markdown="${escapeHtml(item.id)}" type="button">Markdown</button>
        <button class="favorite ${item.favorite ? 'is-favorite' : ''}" data-favorite="${escapeHtml(item.id)}" type="button">${item.favorite ? 'Saved' : 'Save'}</button>
      </div>
    </div>
    <section class="detail-hero">
      <div>
        <p class="eyebrow">${escapeHtml(item.series || 'Study page')}</p>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.speaker || 'Unknown speaker')} <span>|</span> ${dateLabel(item.createdAt)}</p>
        <div class="detail-tags">${[item.passage, ...(item.topics || []), ...(notes.keywords || [])].filter(Boolean).slice(0, 10).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      </div>
      <img src="${escapeHtml(item.thumbnail)}" alt="" loading="lazy">
    </section>
    <div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(item.videoId)}" title="${escapeHtml(item.title)}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    <section class="detail-note">
      <p class="eyebrow">Message summary</p>
      <p>${escapeHtml(notes.summary || '')}</p>
    </section>
    <div class="detail-columns">
      <section><h3>Key takeaways</h3><ol class="takeaways">${(notes.takeaways || []).map(text => `<li>${escapeHtml(text)}</li>`).join('') || '<li>No takeaways captured yet.</li>'}</ol></section>
      <section><h3>Study outline</h3><div class="outline">${(notes.outline || []).map(point => `<article><strong>${escapeHtml(point.title)}</strong><p>${escapeHtml(point.point)}</p></article>`).join('') || '<p class="muted-text">No outline captured yet.</p>'}</div></section>
    </div>
    <div class="detail-columns">
      <section><h3>Discussion questions</h3><ul class="question-list">${(notes.questions || []).map(text => `<li>${escapeHtml(text)}</li>`).join('') || '<li>What should I remember and practice?</li>'}</ul></section>
      <section><h3>Memorable moments</h3><div class="highlights">${(notes.highlights || []).map(text => `<blockquote>${escapeHtml(text)}</blockquote>`).join('') || '<p class="muted-text">No highlights captured yet.</p>'}</div></section>
    </div>
    ${notes.prayer ? `<section class="prayer-panel"><h3>Prayer prompt</h3><p>${escapeHtml(notes.prayer)}</p></section>` : ''}
    <section class="reflection-panel">
      <h3>My reflections</h3>
      <textarea id="reflection" maxlength="5000" rows="6" placeholder="What stood out, and how will you put it into practice?">${escapeHtml(item.reflection || '')}</textarea>
      <div><button class="side-add" data-save-reflection="${escapeHtml(item.id)}" type="button">Save reflection</button><span id="reflection-status" role="status"></span></div>
    </section>
    <details class="transcript-panel">
      <summary>Read full transcript</summary>
      <p>${escapeHtml(item.transcript)}</p>
    </details>
    <div class="detail-bottom">
      <small>Notes: ${notes.mode === 'ai' ? 'AI-assisted' : 'extractive'} | Transcript: ${escapeHtml(item.source)}. Verify against the original sermon.</small>
      <button class="delete-button" data-delete="${escapeHtml(item.id)}" type="button">Remove sermon</button>
    </div>
  </div>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

function showAuth(mode = 'login') {
  authMode = mode;
  $('#auth-title').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
  $('#auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('#auth-switch').textContent = mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in';
  $('#auth-form').elements.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#invite-field').hidden = mode !== 'register' || !inviteRequired;
  $('#invite-code').required = mode === 'register' && inviteRequired;
  if (mode === 'login') $('#invite-code').value = '';
  $('#auth-message').textContent = '';
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}

async function importOldLibrary() {
  const old = loadOldLibrary();
  if (!old.length || !confirm(`Import ${old.length} sermon${old.length === 1 ? '' : 's'} saved in this browser into your account?`)) return;
  for (const sermon of old) await api('/api/sermons', { method: 'POST', body: JSON.stringify(sermon) });
  localStorage.removeItem(KEY);
  await refreshLibrary();
}

['#add-side', '#add-top', '#add-empty'].forEach(selector => $(selector).addEventListener('click', openAdd));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => el.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(el => el.addEventListener('click', event => { if (event.target === el && el.id !== 'auth-dialog') el.close(); }));
['#search', '#speaker-filter', '#series-filter', '#topic-filter', '#source-filter', '#sort-select'].forEach(selector => $(selector).addEventListener(selector === '#search' ? 'input' : 'change', render));

$('#clear-filters').addEventListener('click', () => {
  ['#search', '#speaker-filter', '#series-filter', '#topic-filter', '#source-filter'].forEach(selector => { $(selector).value = ''; });
  render();
});

$('#grid-view').addEventListener('click', () => { viewMode = 'grid'; localStorage.setItem('sermonwise.view', viewMode); render(); });
$('#list-view').addEventListener('click', () => { viewMode = 'list'; localStorage.setItem('sermonwise.view', viewMode); render(); });
$('#nav-library').addEventListener('click', () => { favoritesOnly = false; $('#nav-library').classList.add('active'); $('#nav-favorites').classList.remove('active'); render(); });
$('#nav-favorites').addEventListener('click', () => { favoritesOnly = true; $('#nav-favorites').classList.add('active'); $('#nav-library').classList.remove('active'); render(); });

$('#add-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const button = $('#submit-button');
  button.disabled = true;
  button.textContent = 'Creating notes...';
  $('#form-message').textContent = 'This can take a few minutes if audio transcription is needed.';
  try {
    const result = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ url: data.url, transcript: data.transcript }) });
    const draft = {
      url: `https://www.youtube.com/watch?v=${result.videoId}`,
      videoId: result.videoId,
      title: result.title,
      speaker: data.speaker.trim() || result.speaker,
      series: data.series.trim(),
      passage: data.passage.trim() || result.notes.passages?.[0] || '',
      topics: data.topics.split(',').map(text => text.trim()).filter(Boolean),
      transcript: result.transcript,
      source: result.source,
      notes: result.notes
    };
    const sermon = (await api('/api/sermons', { method: 'POST', body: JSON.stringify(draft) })).sermon;
    sermons.unshift(sermon);
    render();
    form.reset();
    $('#add-dialog').close();
    openDetail(sermon.id);
  } catch (error) {
    $('#form-message').textContent = error.message;
    if (/paste the transcript manually/i.test(error.message)) {
      const details = form.querySelector('.transcript-details');
      const transcript = form.elements.transcript;
      if (details) details.open = true;
      if (transcript) transcript.focus();
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Create study notes';
  }
});

document.addEventListener('click', async event => {
  const open = event.target.closest('[data-open]');
  const favorite = event.target.closest('[data-favorite]');
  const remove = event.target.closest('[data-delete]');
  const saveReflection = event.target.closest('[data-save-reflection]');
  const copy = event.target.closest('[data-copy-markdown]');
  const download = event.target.closest('[data-download-markdown]');

  if (open) openDetail(open.dataset.open);
  if (favorite) {
    const item = sermons.find(x => x.id === favorite.dataset.favorite);
    if (item) {
      try {
        const result = await api(`/api/sermons/${item.id}`, { method: 'PATCH', body: JSON.stringify({ favorite: !item.favorite }) });
        Object.assign(item, result.sermon);
        render();
        if ($('#detail-dialog').open) openDetail(item.id);
      } catch (error) {
        alert(error.message);
      }
    }
  }
  if (remove && confirm('Remove this sermon from your library?')) {
    try {
      await api(`/api/sermons/${remove.dataset.delete}`, { method: 'DELETE' });
      sermons = sermons.filter(item => item.id !== remove.dataset.delete);
      $('#detail-dialog').close();
      render();
    } catch (error) {
      alert(error.message);
    }
  }
  if (saveReflection) {
    try {
      const result = await api(`/api/sermons/${saveReflection.dataset.saveReflection}`, { method: 'PATCH', body: JSON.stringify({ reflection: $('#reflection').value }) });
      const item = sermons.find(x => x.id === result.sermon.id);
      if (item) Object.assign(item, result.sermon);
      $('#reflection-status').textContent = 'Saved';
    } catch (error) {
      $('#reflection-status').textContent = error.message;
    }
  }
  if (copy) {
    const item = sermons.find(x => x.id === copy.dataset.copyMarkdown);
    if (item) {
      await copyText(markdownFor(item));
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy notes'; }, 1200);
    }
  }
  if (download) {
    const item = sermons.find(x => x.id === download.dataset.downloadMarkdown);
    if (item) downloadText(`${safeFileName(item.title)}.md`, markdownFor(item));
  }
  if (event.target.closest('[data-detail-close]')) $('#detail-dialog').close();
});

$('#export').addEventListener('click', () => {
  downloadText('sermonwise-library.json', JSON.stringify({ version: 1, sermons }, null, 2), 'application/json');
});

$('#import').addEventListener('change', async event => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.sermons) || data.version !== 1) throw new Error('Invalid library file.');
    const incoming = data.sermons.filter(item => item && typeof item.title === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(item.videoId) && typeof item.transcript === 'string' && item.notes && typeof item.notes.summary === 'string').slice(0, 500);
    for (const sermon of incoming) await api('/api/sermons', { method: 'POST', body: JSON.stringify(sermon) });
    await refreshLibrary();
  } catch (error) {
    alert(error.message || 'Could not import library.');
  }
  event.target.value = '';
});

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
  } catch (error) {
    $('#auth-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  currentUser = null;
  sermons = [];
  $('#account-email').textContent = 'Sign in to sync';
  $('#logout').hidden = true;
  render();
  showAuth();
});

async function init() {
  try {
    const status = await api('/api/status');
    inviteRequired = Boolean(status.inviteRequired);
    $('#ai-status').textContent = status.aiConfigured ? 'AI ready' : 'Extractive mode';
    $('#storage-status').textContent = `${status.storage === 'postgres' ? 'Postgres' : 'Local'} storage active`;
  } catch {
    $('#ai-status').textContent = 'Status unavailable';
    $('#storage-status').textContent = 'Check server';
  }

  try {
    const result = await api('/api/me');
    if (result.user) {
      currentUser = result.user;
      $('#account-email').textContent = currentUser.email;
      $('#logout').hidden = false;
      await refreshLibrary();
      await importOldLibrary();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

render();
init();
