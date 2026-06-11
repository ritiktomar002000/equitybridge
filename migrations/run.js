// migrations/run.js — runs on every deploy, safe to re-run (IF NOT EXISTS everywhere)
require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

async function run() {
  const config = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME     || 'equitybridge',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      };

  const pool   = new Pool(config);
  const client = await pool.connect();

  console.log('▶  Running database migrations...');
  try {
    const files = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
      console.log(`   ${file}`);
      await client.query(sql);
    }
    console.log('✅ Migrations complete.\n');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
