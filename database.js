// Подключение к PostgreSQL (Supabase). Схема создаётся скриптом 01_schema.sql.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не задан (Render -> Environment)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10
});
pool.on('error', e => console.error('[DB]', e.message));

module.exports = pool;
