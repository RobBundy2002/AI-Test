import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieToken, hashPassword, normalizeEmail, sessionCookie, tokenHash, validEmail, validPassword, verifyPassword } from '../src/auth.js';

test('password hashes verify without storing plaintext', async () => {
  const encoded = await hashPassword('a-long-password-123');
  assert.ok(!encoded.includes('a-long-password-123'));
  assert.equal(await verifyPassword('a-long-password-123', encoded), true);
  assert.equal(await verifyPassword('wrong-password', encoded), false);
  assert.equal(await verifyPassword('anything', 'invalid'), false);
});

test('validates account input and uses secure cookie attributes', () => {
  assert.equal(normalizeEmail(' Test@Example.COM '), 'test@example.com');
  assert.equal(validEmail('test@example.com'), true);
  assert.equal(validEmail('bad-email'), false);
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword('a-long-password'), true);
  assert.equal(cookieToken('other=a; sermonwise_session=secret; more=b'), 'secret');
  assert.match(sessionCookie('secret', true), /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure/);
  assert.notEqual(tokenHash('secret'), 'secret');
});
