import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const emptyData = () => ({ users: [], sessions: [], sermons: [] });
const clone = value => JSON.parse(JSON.stringify(value));

export async function createLocalStore(filePath = join(process.cwd(), '.data', 'sermonwise.json')) {
  let data = await load(filePath);
  let writes = Promise.resolve();

  const save = async () => {
    const snapshot = JSON.stringify(data, null, 2);
    writes = writes.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      await writeFile(temp, snapshot);
      await rename(temp, filePath);
    });
    await writes;
  };

  const pruneSessions = async () => {
    const now = Date.now();
    const next = data.sessions.filter(session => new Date(session.expires_at).getTime() > now);
    if (next.length !== data.sessions.length) {
      data.sessions = next;
      await save();
    }
  };

  return {
    kind: 'local',
    async createUser(id, email, passwordHash) {
      if (data.users.some(user => user.email === email)) return null;
      const user = { id, email, password_hash: passwordHash, created_at: new Date().toISOString() };
      data.users.push(user);
      await save();
      return { id, email };
    },
    async getUserByEmail(email) {
      return clone(data.users.find(user => user.email === email) || null);
    },
    async getUserBySession(tokenHash) {
      await pruneSessions();
      const session = data.sessions.find(item => item.token_hash === tokenHash);
      if (!session) return null;
      const user = data.users.find(item => item.id === session.user_id);
      return user ? { id: user.id, email: user.email } : null;
    },
    async createSession(tokenHash, userId, expiresAt) {
      data.sessions = data.sessions.filter(session => session.token_hash !== tokenHash);
      data.sessions.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt.toISOString() });
      await save();
    },
    async deleteSession(tokenHash) {
      data.sessions = data.sessions.filter(session => session.token_hash !== tokenHash);
      await save();
    },
    async listSermons(userId) {
      return data.sermons
        .filter(row => row.user_id === userId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map(row => clone(row.payload));
    },
    async addSermon(userId, sermon) {
      if (data.sermons.some(row => row.user_id === userId && row.id === sermon.id)) return;
      data.sermons.push({ id: sermon.id, user_id: userId, payload: clone(sermon), created_at: sermon.createdAt || new Date().toISOString() });
      await save();
    },
    async updateSermon(userId, id, sermon) {
      const row = data.sermons.find(item => item.user_id === userId && item.id === id);
      if (!row) return false;
      row.payload = clone(sermon);
      await save();
      return true;
    },
    async getSermon(userId, id) {
      const row = data.sermons.find(item => item.user_id === userId && item.id === id);
      return row ? clone(row.payload) : null;
    },
    async deleteSermon(userId, id) {
      const before = data.sermons.length;
      data.sermons = data.sermons.filter(row => row.user_id !== userId || row.id !== id);
      if (data.sermons.length === before) return false;
      await save();
      return true;
    },
    async health() {
      await mkdir(dirname(filePath), { recursive: true });
    },
    async close() {}
  };
}

async function load(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      sermons: Array.isArray(parsed.sermons) ? parsed.sermons : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') return emptyData();
    throw error;
  }
}
