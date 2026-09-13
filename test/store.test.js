import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPgStore } from '../src/store.js';

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
