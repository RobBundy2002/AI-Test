import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const normalizeEmail = value => String(value || '').trim().toLowerCase();
export const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
export const validPassword = password => typeof password === 'string' && password.length >= 12 && password.length <= 200;
export const newId = () => randomUUID();
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = token => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, hash] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}

export function sessionCookie(token, secure = process.env.NODE_ENV === 'production') {
  return `sermonwise_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure ? '; Secure' : ''}`;
}

export function cookieToken(header) {
  return String(header || '').split(';').map(x => x.trim()).find(x => x.startsWith('sermonwise_session='))?.slice('sermonwise_session='.length) || '';
}
