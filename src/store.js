import pg from 'pg';

const { Pool } = pg;

export async function createPgStore(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required for account storage.');
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30000, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)');
  await pool.query(`CREATE TABLE IF NOT EXISTS sermons (
    id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id)
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS sermons_user_created_idx ON sermons(user_id, created_at DESC)');
  return {
    async createUser(id, email, passwordHash) {
      try { await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, email, passwordHash]); return { id, email }; }
      catch (error) { if (error.code === '23505') return null; throw error; }
    },
    async getUserByEmail(email) { return (await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1', [email])).rows[0] || null; },
    async getUserBySession(tokenHash) { return (await pool.query('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=$1 AND expires_at > now()', [tokenHash])).rows[0] || null; },
    async createSession(tokenHash, userId, expiresAt) { await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [tokenHash, userId, expiresAt]); },
    async deleteSession(tokenHash) { await pool.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]); },
    async listSermons(userId) { return (await pool.query('SELECT payload FROM sermons WHERE user_id=$1 ORDER BY created_at DESC', [userId])).rows.map(row => row.payload); },
    async addSermon(userId, sermon) { await pool.query('INSERT INTO sermons(id,user_id,payload) VALUES($1,$2,$3) ON CONFLICT(user_id,id) DO NOTHING', [sermon.id, userId, sermon]); },
    async updateSermon(userId, id, sermon) { const result = await pool.query('UPDATE sermons SET payload=$3 WHERE id=$1 AND user_id=$2', [id, userId, sermon]); return result.rowCount > 0; },
    async getSermon(userId, id) { return (await pool.query('SELECT payload FROM sermons WHERE id=$1 AND user_id=$2', [id, userId])).rows[0]?.payload || null; },
    async deleteSermon(userId, id) { const result = await pool.query('DELETE FROM sermons WHERE id=$1 AND user_id=$2', [id, userId]); return result.rowCount > 0; },
    async health() { await pool.query('SELECT 1'); },
    async close() { await pool.end(); }
  };
}
