import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

function fakeStore() {
  const users = new Map(), sessions = new Map(), sermons = new Map();
  return {
    async createUser(id, email, password_hash) { if (users.has(email)) return null; const user = { id, email, password_hash }; users.set(email, user); sermons.set(id, new Map()); return user; },
    async getUserByEmail(email) { return users.get(email) || null; },
    async getUserBySession(token) { const id = sessions.get(token); return [...users.values()].find(x => x.id === id) || null; },
    async createSession(token, id) { sessions.set(token, id); },
    async deleteSession(token) { sessions.delete(token); },
    async listSermons(id) { return [...sermons.get(id).values()]; },
    async addSermon(id, sermon) { sermons.get(id).set(sermon.id, sermon); },
    async getSermon(id, sermonId) { return sermons.get(id).get(sermonId) || null; },
    async updateSermon(id, sermonId, sermon) { if (!sermons.get(id).has(sermonId)) return false; sermons.get(id).set(sermonId, sermon); return true; },
    async deleteSermon(id, sermonId) { return sermons.get(id).delete(sermonId); },
    async health() {}
  };
}

async function withApp(fn) {
  const app = createApp({ store: fakeStore(), secureCookies: false });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${app.address().port}`); }
  finally { await new Promise(resolve => app.close(resolve)); }
}

test('users have isolated libraries across sessions', async () => {
  await withApp(async base => {
    const call = async (path, method = 'GET', body, cookie = '') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) });
    const register = async email => { const res = await call('/api/register', 'POST', { email, password: 'a-long-password-123' }); assert.equal(res.status, 200); assert.deepEqual(Object.keys((await res.json()).user).sort(), ['email', 'id']); return res.headers.get('set-cookie').split(';')[0]; };
    const first = await register('first@example.com');
    const second = await register('second@example.com');
    const draft = { url: 'https://youtu.be/abcdefghijk', title: 'Hope', transcript: 'We can hope.', notes: { summary: 'Hope matters.', takeaways: [], highlights: [], passages: [] } };
    const created = await call('/api/sermons', 'POST', draft, first);
    assert.equal(created.status, 201);
    const sermon = (await created.json()).sermon;
    assert.equal((await (await call('/api/sermons', 'GET', null, first)).json()).sermons.length, 1);
    assert.deepEqual((await (await call('/api/sermons', 'GET', null, second)).json()).sermons, []);
    assert.equal((await call(`/api/sermons/${sermon.id}`, 'PATCH', { favorite: true }, second)).status, 404);
    assert.equal((await call(`/api/sermons/${sermon.id}`, 'DELETE', null, second)).status, 404);
    assert.equal((await call('/api/sermons')).status, 401);
    assert.equal((await call('/api/logout', 'POST', null, first)).status, 200);
    assert.equal((await call('/api/sermons', 'GET', null, first)).status, 401);
    const login = await call('/api/login', 'POST', { email: 'first@example.com', password: 'a-long-password-123' });
    const newCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await call('/api/sermons', 'GET', null, newCookie)).json()).sermons.length, 1);
  });
});

test('invalid auth and cross-origin mutations are rejected', async () => {
  await withApp(async base => {
    const bad = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bad', password: 'short' }) });
    assert.equal(bad.status, 400);
    const cross = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ email: 'good@example.com', password: 'a-long-password' }) });
    assert.equal(cross.status, 403);
  });
});
