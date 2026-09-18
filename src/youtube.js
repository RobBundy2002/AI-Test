import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const YT_DLP_MISSING = 'yt-dlp is not installed or is not available to the server. Install it with `python3 -m pip install --user yt-dlp`, set YT_DLP_PATH, or paste the transcript manually.';
const AUDIO_TYPES = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm'
};

export async function metadata(id, fetcher = fetch) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Could not read YouTube video details.');
  const data = await response.json();
  return { title: String(data.title || 'Untitled sermon').slice(0, 200), speaker: String(data.author_name || '').slice(0, 100), thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
}

function run(command, args, timeout = 300000, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', b => { stdout += b.toString().slice(0, 100000 - stdout.length); });
    child.stderr.on('data', b => { stderr += b.toString().slice(0, 100000 - stderr.length); });
    child.on('error', error => {
      clearTimeout(timer);
      if (error.code === 'ENOENT' && options.missingMessage) reject(new Error(options.missingMessage));
      else reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const message = stderr.slice(-300) || 'YouTube extraction failed.';
      if (code === 0) resolve(stdout);
      else if (options.missingPattern?.test(message)) reject(new Error(options.missingMessage));
      else reject(new Error(message));
    });
  });
}

async function runYtDlp(args, timeout) {
  if (process.env.YT_DLP_PATH) return run(process.env.YT_DLP_PATH, args, timeout, { missingMessage: YT_DLP_MISSING });
  try {
    return await run('yt-dlp', args, timeout, { missingMessage: YT_DLP_MISSING });
  } catch (error) {
    if (error.message !== YT_DLP_MISSING) throw error;
    return run('python3', ['-m', 'yt_dlp', ...args], timeout, { missingMessage: YT_DLP_MISSING, missingPattern: /No module named yt_dlp/ });
  }
}

function stripVtt(vtt) {
  const seen = new Set();
  return vtt.split(/\r?\n/).filter(line => line && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') && !line.startsWith('Language:') && !/^(?:\d+|\d\d:\d\d:|\d\d:).*(?:-->|$)/.test(line) && !line.includes('-->')).map(line => line.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<').trim()).filter(line => { if (!line || seen.has(line)) return false; seen.add(line); return true; }).join(' ');
}

export async function captions(id) {
  const dir = await mkdtemp(join(tmpdir(), 'sermonwise-'));
  try {
    const attempts = [
      [],
      ['--extractor-args', 'youtube:player_client=android']
    ];
    let lastError;
    for (const extra of attempts) {
      try {
        await runYtDlp([...extra, '--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt', '--no-playlist', '--output', join(dir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], 120000);
        lastError = null;
        const file = (await readdir(dir)).filter(name => name.endsWith('.vtt')).sort((a, b) => scoreSubtitleName(a) - scoreSubtitleName(b))[0];
        if (file) return stripVtt(await readFile(join(dir, file), 'utf8')).slice(0, 100000);
      } catch (error) {
        if (error.message === YT_DLP_MISSING) throw error;
        lastError = error;
      }
    }
    if (lastError) throw new Error('YouTube blocked caption download for this video. Paste the transcript manually to create notes for it.');
    return '';
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function scoreSubtitleName(name) {
  if (/\.en\.vtt$/i.test(name)) return 0;
  if (/\.en-orig\.vtt$/i.test(name)) return 1;
  return 2;
}

export async function transcribeAudio(id, apiKey, fetcher = fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'sermonwise-'));
  try {
    await runYtDlp(['--no-playlist', '--max-filesize', '24M', '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best', '--output', join(dir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], 300000);
    const file = (await readdir(dir)).find(name => /\.(?:m4a|mp4|mp3|mpeg|mpga|wav|webm)$/i.test(name));
    if (!file) throw new Error('Could not extract audio from this video.');
    const path = join(dir, file);
    if ((await stat(path)).size > 24 * 1024 * 1024) throw new Error('This video is too large to transcribe automatically.');
    const ext = file.split('.').pop().toLowerCase();
    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append('file', new Blob([await readFile(path)], { type: AUDIO_TYPES[ext] || 'application/octet-stream' }), `sermon.${ext}`);
    const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error('Audio transcription failed.');
    return String((await response.json()).text || '').slice(0, 100000);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
