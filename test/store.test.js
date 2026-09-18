import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalStore } from '../src/local-store.js';
import { createPgStore } from '../src/store.js';

test('local store persists users, sessions, and sermons', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sermonwise-test-'));
  const file = join(dir, 'store.json');
  try {
    let store = await createLocalStore(file);
    const userId = randomUUID();
    const sermonId = randomUUID();
    await store.createUser(userId, 'local@example.test', 'hash');
    await store.createSession('session-hash', userId, new Date(Date.now() + 60000));
    await store.addSermon(userId, { id: sermonId, title: 'Local sermon', createdAt: '2026-01-01T00:00:00.000Z' });
    assert.equal((await store.getUserBySession('session-hash')).email, 'local@example.test');
    assert.equal((await store.listSermons(userId))[0].title, 'Local sermon');
    await store.close();

    store = await createLocalStore(file);
    assert.equal((await store.getUserByEmail('local@example.test')).id, userId);
    assert.equal((await store.getSermon(userId, sermonId)).title, 'Local sermon');
    assert.equal(await store.deleteSermon(userId, sermonId), true);
    assert.deepEqual(await store.listSermons(userId), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PostgreSQL persists separate user libraries and sessions', { skip: !process.env.DATABASE_URL }, async () => {
  const store = await createPgStore();
  try {
    const first = randomUUID(), second = randomUUID(), sermonId = randomUUID();
    await store.createUser(first, `${first}@example.test`, 'hash');
    await store.createUser(second, `${second}@example.test`, 'hash');
    await store.createSession('test-' + first, first, new Date(Date.now() + 60000));
    await store.addSermon(first, { id: sermonId, title: 'First user sermon' });
    assert.equal((await store.getUserBySession('test-' + first)).id, first);
    assert.equal((await store.listSermons(first)).length, 1);
    assert.deepEqual(await store.listSermons(second), []);
    assert.equal(await store.getSermon(second, sermonId), null);
    assert.equal(await store.deleteSermon(second, sermonId), false);
    assert.equal((await store.listSermons(first)).length, 1);
    await store.deleteSession('test-' + first);
    assert.equal(await store.getUserBySession('test-' + first), null);
  } finally { await store.close(); }
});
