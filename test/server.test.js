import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

async function withApp(options, fn) {
  const app = createApp(options);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${app.address().port}`); }
  finally { await new Promise(resolve => app.close(resolve)); }
}

test('health and homepage are served', async () => {
  await withApp({}, async base => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    assert.match(await (await fetch(base)).text(), /SermonWise/);
  });
});

test('analyzes a captioned video and returns notes', async () => {
  await withApp({ getMetadata: async () => ({ title: 'Faith and Hope', speaker: 'Pastor Lee', thumbnail: 'image' }), getCaptions: async () => 'Hope is a gift we share with our neighbors. We can practice patient kindness with each person we meet.', apiKey: '' }, async base => {
    const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://youtu.be/abcdefghijk' }) });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.videoId, 'abcdefghijk');
    assert.equal(data.source, 'captions');
    assert.equal(data.notes.mode, 'extractive');
  });
});

test('uses audio transcription when captions are missing and a key exists', async () => {
  let called = false;
  await withApp({ getMetadata: async () => ({ title: 'Test' }), getCaptions: async () => '', getTranscription: async () => { called = true; return 'Patient love can make us more attentive to the needs of our neighbors.'; }, makeNotes: async () => ({ summary: 'Patient love matters.', takeaways: [], highlights: [], passages: [], mode: 'ai' }), apiKey: 'test-key' }, async base => {
    const response = await fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://youtu.be/abcdefghijk' }) });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source, 'audio');
    assert.equal(called, true);
  });
});

test('rejects invalid links and explains captionless fallback', async () => {
  await withApp({ getMetadata: async () => ({ title: 'Test' }), getCaptions: async () => '', apiKey: '' }, async base => {
    const request = url => fetch(`${base}/api/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    assert.equal((await request('https://evil.test/video')).status, 400);
    const response = await request('https://youtu.be/abcdefghijk');
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /paste a transcript/i);
  });
});
