import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractiveNotes, normalizeTranscript, parseAiNotes, videoId } from './src/analyze.js';
import { captions, metadata, transcribeAudio } from './src/youtube.js';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
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
        { role: 'system', content: 'You create accurate sermon study notes. Return JSON with summary (2-4 concise sentences), takeaways (3-5 actionable insights), highlights (up to 4 short memorable paraphrases, not invented quotes), passages (only Bible references explicitly mentioned). Stay faithful to the transcript. Do not invent claims or scripture.' },
        { role: 'user', content: transcript.slice(0, 50000) }
      ] }), signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error('AI note generation failed');
    const data = await response.json();
    return { ...parseAiNotes(data.choices?.[0]?.message?.content || '', fallback), mode: 'ai' };
  } catch { return { ...fallback, mode: 'extractive' }; }
}

export function createApp({ getMetadata = metadata, getCaptions = captions, getTranscription = transcribeAudio, makeNotes = aiNotes, apiKey = process.env.OPENAI_API_KEY || '' } = {}) {
  return createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (req.url === '/health') return send(200, { ok: true });
    if (req.url === '/api/analyze' && req.method === 'POST') {
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
      } catch (error) { return send(422, { error: error.message || 'Could not analyze this sermon.' }); }
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
  createApp().listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`SermonWise listening on ${process.env.PORT || 3000}`));
}
