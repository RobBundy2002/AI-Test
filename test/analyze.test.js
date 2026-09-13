import test from 'node:test';
import assert from 'node:assert/strict';
import { extractiveNotes, normalizeTranscript, parseAiNotes, videoId } from '../src/analyze.js';

test('accepts supported YouTube URLs and rejects other hosts', () => {
  assert.equal(videoId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.equal(videoId('https://youtu.be/abcdefghijk?t=2'), 'abcdefghijk');
  assert.equal(videoId('https://youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(videoId('https://youtube.com.evil.test/watch?v=abcdefghijk'), null);
  assert.equal(videoId('https://youtube.com/watch?v=bad'), null);
});

test('creates bounded notes and extracts explicit Bible passages', () => {
  const transcript = 'Today we read Romans 8:28 and consider hope in suffering. Hope does not mean that suffering disappears, but it helps us remain faithful. When we support each other through suffering, we show love to our neighbors. Remember that patient love can be an act of hope in hard seasons.';
  const notes = extractiveNotes(transcript);
  assert.ok(notes.summary.includes('hope'));
  assert.ok(notes.takeaways.length >= 2);
  assert.deepEqual(notes.passages, ['Romans 8:28']);
  assert.equal(normalizeTranscript([{ text: 'Hello  world' }, { text: 'Again' }]), 'Hello world Again');
});

test('falls back when AI output is invalid', () => {
  const fallback = extractiveNotes('We can practice patient kindness with our neighbors.');
  assert.deepEqual(parseAiNotes('not json', fallback), fallback);
  assert.equal(parseAiNotes('{"summary":"Good","takeaways":[],"highlights":[],"passages":[]}', fallback).summary, 'Good');
});
