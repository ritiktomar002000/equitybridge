const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'equitybridge'
});

(async () => {
  try {
    const res = await pool.query('SELECT version()');
    console.log('PG CONNECT OK:', res.rows[0].version);
  } catch (err) {
    console.error('PG CONNECT ERROR:', err);
  } finally {
    await pool.end();
  }
})();
