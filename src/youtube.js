import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function metadata(id, fetcher = fetch) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not read YouTube video details.');
  const data = await response.json();
  return { title: String(data.title || 'Untitled sermon').slice(0, 200), speaker: String(data.author_name || '').slice(0, 100), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
}

function run(command, args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', b => { stdout += b.toString().slice(0, 100000 - stdout.length); });
    child.stderr.on('data', b => { stderr += b.toString().slice(0, 100000 - stderr.length); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr.slice(-300) || 'YouTube extraction failed.')); });
  });
}

function stripVtt(vtt) {
  const seen = new Set();
  return vtt.split(/\r?\n/).filter(line => line && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && !/^(?:\d+|\d\d:\d\d:|\d\d:).*(?:-->|$)/.test(line) && !line.includes('-->')).map(line => line.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').trim()).filter(line => { if (!line || seen.has(line)) return false; seen.add(line); return true; }).join(' ');
}

export async function captions(id) {
  const dir = await mkdtemp(join(tmpdir(), 'sermonwise-'));
  try {
    await run('yt-dlp', ['--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt', '--no-playlist', '--output', join(dir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], 120000);
    const file = (await readdir(dir)).find(name => name.endsWith('.vtt'));
    return file ? stripVtt(await readFile(join(dir, file), 'utf8')).slice(0, 100000) : '';
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function transcribeAudio(id, apiKey, fetcher = fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'sermonwise-'));
  try {
    await run('yt-dlp', ['-x', '--audio-format', 'mp3', '--audio-quality', '9', '--no-playlist', '--max-filesize', '24M', '--output', join(dir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], 300000);
    const file = (await readdir(dir)).find(name => name.endsWith('.mp3'));
    if (!file) throw new Error('Could not extract audio from this video.');
    const path = join(dir, file);
    if ((await stat(path)).size > 24 * 1024 * 1024) throw new Error('This video is too large to transcribe automatically.');
    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append('file', new Blob([await readFile(path)], { type: 'audio/mpeg' }), 'sermon.mp3');
    const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('Audio transcription failed.');
    return String((await response.json()).text || '').slice(0, 100000);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
