import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractiveNotes, normalizeTranscript, parseAiNotes, videoId } from './src/analyze.js';
import { captions, metadata, transcribeAudio } from './src/youtube.js';
import { createLocalStore } from './src/local-store.js';
import { createPgStore } from './src/store.js';
import { cookieToken, hashPassword, newId, newToken, normalizeEmail, sessionCookie, tokenHash, validEmail, validPassword, verifyPassword } from './src/auth.js';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const root = join(appDir, 'public');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function jsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 120000) throw new Error('Transcript is too long.');
  }
  return JSON.parse(body);
}

async function aiNotes(transcript, apiKey, fallback, fetcher = fetch) {
  if (!apiKey) return { ...fallback, mode: 'extractive' };
  try {
    const response = await fetcher('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'You create accurate sermon study notes. Return JSON with summary (2-4 concise sentences), takeaways (3-5 actionable insights), highlights (up to 4 short memorable paraphrases, not invented quotes), passages (only Bible references explicitly mentioned), outline (3-5 objects with title and point), questions (3-5 reflection or discussion questions), keywords (5-10 short tags), and prayer (one short first-person prayer). Stay faithful to the transcript. Do not invent claims or scripture.' },
        { role: 'user', content: transcript.slice(0, 50000) }
      ] }), signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error('AI note generation failed');
    const data = await response.json();
    return { ...parseAiNotes(data.choices?.[0]?.message?.content || '', fallback), mode: 'ai' };
  } catch { return { ...fallback, mode: 'extractive' }; }
}

function analyzeError(error) {
  const message = String(error?.message || '');
  if (/HTTP Error 403|SABR|PO Token|page needs to be reloaded|Video unavailable|unable to download video data/i.test(message)) {
    return 'YouTube blocked automated transcript or audio access for this video. Try again, or paste the transcript manually.';
  }
  return message || 'Could not analyze this sermon.';
}

function secretEqual(value, expected) {
  const left = Buffer.from(String(value || '').trim());
  const right = Buffer.from(String(expected || '').trim());
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function cleanSermon(input) {
  if (!input || !videoId(input.url) || typeof input.title !== 'string' || !input.title.trim() || typeof input.transcript !== 'string' || !input.notes || typeof input.notes.summary !== 'string') return null;
  const video = videoId(input.url);
  const noteArray = (name, limit, size) => Array.isArray(input.notes[name]) ? input.notes[name].slice(0, limit).map(x => String(x).slice(0, size)).filter(Boolean) : [];
  return {
    id: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.id || '') ? input.id : newId(), url: `https://www.youtube.com/watch?v=${video}`, videoId: video,
    title: input.title.trim().slice(0, 200), speaker: String(input.speaker || '').slice(0, 100),
    series: String(input.series || '').slice(0, 100), passage: String(input.passage || '').slice(0, 100),
    topics: Array.isArray(input.topics) ? input.topics.slice(0, 10).map(x => String(x).slice(0, 60)) : [],
    thumbnail: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`,
    transcript: input.transcript.slice(0, 100000), source: ['captions', 'audio', 'pasted'].includes(input.source) ? input.source : 'pasted',
    notes: {
      summary: input.notes.summary.slice(0, 1400),
      takeaways: noteArray('takeaways', 6, 350),
      highlights: noteArray('highlights', 4, 350),
      passages: noteArray('passages', 8, 80),
      outline: Array.isArray(input.notes.outline) ? input.notes.outline.slice(0, 6).map((x, index) => typeof x === 'string' ? { title: `Point ${index + 1}`, point: x.slice(0, 260) } : { title: String(x?.title || `Point ${index + 1}`).slice(0, 80), point: String(x?.point || '').slice(0, 260) }).filter(x => x.point) : [],
      questions: noteArray('questions', 6, 180),
      keywords: noteArray('keywords', 10, 40),
      prayer: String(input.notes.prayer || '').slice(0, 600),
      mode: input.notes.mode === 'ai' ? 'ai' : 'extractive'
    },
    favorite: Boolean(input.favorite), reflection: String(input.reflection || '').slice(0, 5000), createdAt: new Date().toISOString()
  };
}

async function loadEnv() {
  try {
    const text = await readFile(join(appDir, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function createConfiguredStore() {
  if (process.env.DATABASE_URL) return createPgStore();
  return createLocalStore(process.env.LOCAL_STORE_PATH || join(appDir, '.data', 'sermonwise.json'));
}

export function createApp({ getMetadata = metadata, getCaptions = captions, getTranscription = transcribeAudio, makeNotes = aiNotes, apiKey = process.env.OPENAI_API_KEY || '', inviteCode = process.env.INVITE_CODE || '', store = null, secureCookies = process.env.NODE_ENV === 'production' } = {}) {
  const attempts = new Map();
  return createServer(async (req, res) => {
    const send = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(data)); };
    if (req.url === '/health') { try { if (store) await store.health(); return send(200, { ok: true }); } catch { return send(503, { ok: false }); } }
    if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: 'Invalid request origin.' }); }
      catch { return send(403, { error: 'Invalid request origin.' }); }
    }
    const user = async () => { const token = cookieToken(req.headers.cookie); const record = token && store ? await store.getUserBySession(tokenHash(token)) : null; return record ? { id: record.id, email: record.email } : null; };
    if (req.url === '/api/me' && req.method === 'GET') return send(200, { user: await user() });
    if (req.url === '/api/status' && req.method === 'GET') return send(200, { aiConfigured: Boolean(apiKey), inviteRequired: Boolean(inviteCode), storage: store?.kind || 'custom' });
    if (['/api/register', '/api/login'].includes(req.url) && req.method === 'POST') {
      if (!store) return send(503, { error: 'Account storage is not configured.' });
      const ip = req.socket.remoteAddress || 'unknown';
      const recent = (attempts.get(ip) || []).filter(x => x > Date.now() - 15 * 60 * 1000);
      if (recent.length >= 20) return send(429, { error: 'Too many sign-in attempts. Try again later.' });
      recent.push(Date.now()); attempts.set(ip, recent);
      try {
        const body = await jsonBody(req);
        const email = normalizeEmail(body.email);
        if (!validEmail(email) || typeof body.password !== 'string') return send(400, { error: 'Enter a valid email and password.' });
        let account;
        if (req.url === '/api/register') {
          if (inviteCode && !secretEqual(body.inviteCode, inviteCode)) return send(403, { error: 'Enter a valid invite code to create an account.' });
          if (!validPassword(body.password)) return send(400, { error: 'Use a password of at least 12 characters.' });
          account = await store.createUser(newId(), email, await hashPassword(body.password));
          if (!account) return send(409, { error: 'An account with this email already exists.' });
        } else {
          const record = await store.getUserByEmail(email);
          if (!record || !(await verifyPassword(body.password, record.password_hash))) return send(401, { error: 'Email or password is incorrect.' });
          account = { id: record.id, email: record.email };
        }
        account = { id: account.id, email: account.email };
        const token = newToken();
        await store.createSession(tokenHash(token), account.id, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
        return send(200, { user: account }, { 'Set-Cookie': sessionCookie(token, secureCookies) });
      } catch { return send(400, { error: 'Could not complete sign-in.' }); }
    }
    if (req.url === '/api/logout' && req.method === 'POST') {
      const token = cookieToken(req.headers.cookie);
      if (store && token) await store.deleteSession(tokenHash(token));
      return send(200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookies).replace(/Max-Age=\d+/, 'Max-Age=0') });
    }
    if (req.url === '/api/sermons' && req.method === 'GET') {
      const account = await user();
      return account ? send(200, { sermons: await store.listSermons(account.id) }) : send(401, { error: 'Sign in to view your library.' });
    }
    if (req.url === '/api/sermons' && req.method === 'POST') {
      const account = await user();
      if (!account) return send(401, { error: 'Sign in to save sermons.' });
      try { const sermon = cleanSermon(await jsonBody(req)); if (!sermon) return send(400, { error: 'Invalid sermon.' }); await store.addSermon(account.id, sermon); return send(201, { sermon }); }
      catch { return send(400, { error: 'Could not save sermon.' }); }
    }
    const sermonMatch = req.url?.match(/^\/api\/sermons\/([a-f0-9-]{36})$/);
    if (sermonMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      const account = await user();
      if (!account) return send(401, { error: 'Sign in to change sermons.' });
      if (req.method === 'DELETE') return send((await store.deleteSermon(account.id, sermonMatch[1])) ? 200 : 404, { ok: true });
      const sermon = await store.getSermon(account.id, sermonMatch[1]);
      if (!sermon) return send(404, { error: 'Sermon not found.' });
      try { const body = await jsonBody(req); if (typeof body.favorite !== 'boolean' && typeof body.reflection !== 'string') return send(400, { error: 'Invalid update.' }); if (typeof body.favorite === 'boolean') sermon.favorite = body.favorite; if (typeof body.reflection === 'string') sermon.reflection = body.reflection.slice(0, 5000); await store.updateSermon(account.id, sermon.id, sermon); return send(200, { sermon }); }
      catch { return send(400, { error: 'Could not update sermon.' }); }
    }
    if (req.url === '/api/analyze' && req.method === 'POST') {
      if (store && !(await user())) return send(401, { error: 'Sign in to analyze sermons.' });
      try {
        const body = await jsonBody(req);
        const id = videoId(body.url);
        if (!id) return send(400, { error: 'Enter a valid YouTube video link.' });
        const details = await getMetadata(id);
        let transcript = normalizeTranscript(body.transcript || '');
        let source = transcript ? 'pasted' : 'captions';
        if (!transcript) { try { transcript = await getCaptions(id); } catch { /* Try audio next. */ } }
        if (!transcript && apiKey) { source = 'audio'; transcript = await getTranscription(id, apiKey); }
        if (!transcript) return send(422, { error: 'No captions were available. Add an OpenAI API key for audio transcription, or paste a transcript.', details });
        const notes = await makeNotes(transcript, apiKey, extractiveNotes(transcript));
        return send(200, { videoId: id, ...details, transcript, source, notes });
      } catch (error) { return send(422, { error: analyzeError(error) }); }
    }
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const safe = normalize(name);
      if (safe.startsWith('..') || safe.startsWith('/') || !['index.html', 'app.js', 'style.css', 'favicon.svg'].includes(safe)) return send(404, { error: 'Not found.' });
      const content = await readFile(join(root, safe));
      res.writeHead(200, { 'Content-Type': `${types[extname(safe)]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
      res.end(content);
    } catch { send(404, { error: 'Not found.' }); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await loadEnv();
  const store = await createConfiguredStore();
  createApp({ store }).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`SermonWise listening on ${process.env.PORT || 3000}`));
}
