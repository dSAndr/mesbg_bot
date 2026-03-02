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

  await pool.query(`
  CREATE TABLE IF NOT EXISTS moves (
      player_id BIGINT PRIMARY KEY,
      kind TEXT NOT NULL,      -- 'photo' или 'document'
      file_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

async function hasPlayer(id) {
  const res = await pool.query(
    `SELECT 1 FROM players WHERE id = $1 LIMIT 1`,
    [id]
  );
  return res.rowCount > 0;
}

async function countPlayers() {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM players`
  );
  return res.rows[0].cnt;
}

async function getPlayer(id) {
  const res = await pool.query(
    `SELECT id, username, first_name, last_name FROM players WHERE id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

async function upsertMove(playerId, kind, fileId) {
  await pool.query(
    `INSERT INTO moves (player_id, kind, file_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (player_id) DO UPDATE SET
       kind = EXCLUDED.kind,
       file_id = EXCLUDED.file_id,
       updated_at = now()`,
    [playerId, kind, fileId]
  );
}

async function hasMove(playerId) {
  const res = await pool.query(`SELECT 1 FROM moves WHERE player_id = $1`, [playerId]);
  return res.rowCount > 0;
}

async function countMoves() {
  const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM moves`);
  return res.rows[0].cnt;
}

async function listMoves() {
  const res = await pool.query(
    `SELECT m.player_id, m.kind, m.file_id, p.first_name, p.last_name, p.username
     FROM moves m
     JOIN players p ON p.id = m.player_id
     ORDER BY m.updated_at ASC`
  );
  return res.rows; // [{player_id, kind, file_id, first_name...}]
}

async function clearMoves() {
  await pool.query(`DELETE FROM moves`);
}

async function setState(key, value) {
  await pool.query(
    `INSERT INTO state (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

async function getState(key, defaultValue = null) {
  const res = await pool.query(`SELECT value FROM state WHERE key = $1`, [key]);
  if (res.rowCount === 0) return defaultValue;
  return res.rows[0].value;
}

async function isExpansionOpen() {
  const v = await getState('expansion_open', 'false');
  return v === 'true';
}

async function setExpansionOpen(isOpen) {
  await setState('expansion_open', isOpen ? 'true' : 'false');
}

module.exports = {
  initDb,
  addPlayer,
  removePlayer,
  listPlayers,
  countPlayers,
  hasPlayer,
  getPlayer,
  upsertMove,
  hasMove,
  countMoves,
  listMoves,
  clearMoves,
  setState,
  getState,
  isExpansionOpen,
  setExpansionOpen
};
