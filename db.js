const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // важно для облачных Postgres
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function addPlayer(p) {
  await pool.query(
    `INSERT INTO players (id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name`,
    [p.id, p.username || null, p.first_name || '', p.last_name || '']
  );
}

async function removePlayer(id) {
  await pool.query(`DELETE FROM players WHERE id = $1`, [id]);
}

async function listPlayers() {
  const res = await pool.query(
    `SELECT id, username, first_name, last_name
     FROM players
     ORDER BY created_at ASC`
  );
  return res.rows;
}

module.exports = { initDb, addPlayer, removePlayer, listPlayers };
