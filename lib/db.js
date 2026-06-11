// lib/db.js — PostgreSQL connection pool
// Supports both individual DB_* vars (local) and DATABASE_URL (Railway/Render/Heroku)
const { Pool } = require('pg');

function getPoolConfig() {
  // Cloud platforms provide a single DATABASE_URL
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false'
        ? false
        : { rejectUnauthorized: false },  // required for Render/Railway SSL
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
  }
  // Local development: individual vars
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'equitybridge',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max:               20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

const pool = new Pool(getPoolConfig());

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return { data: result.rows, count: result.rowCount, error: null };
  } catch (err) {
    console.error('DB error:', err.message, '\nSQL:', sql.slice(0, 120));
    return { data: null, count: 0, error: err.message };
  } finally {
    client.release();
  }
}

async function select(table, opts = {}) {
  const cols = opts.columns || '*';
  const params = [];
  let sql = `SELECT ${cols} FROM ${table}`;
  if (opts.where && Object.keys(opts.where).length) {
    const clauses = Object.entries(opts.where).map(([k, v]) => {
      params.push(v); return `${k} = $${params.length}`;
    });
    sql += ` WHERE ${clauses.join(' AND ')}`;
  }
  if (opts.order)  sql += ` ORDER BY ${opts.order}`;
  if (opts.limit)  { params.push(opts.limit);  sql += ` LIMIT $${params.length}`; }
  if (opts.offset) { params.push(opts.offset); sql += ` OFFSET $${params.length}`; }
  const result = await query(sql, params);
  if (result.error) return result;
  if (opts.single) return result.data.length ? { data: result.data[0], error: null } : { data: null, error: 'Not found' };
  return result;
}

async function insert(table, data, opts = {}) {
  const keys = Object.keys(data), values = Object.values(data);
  const ph = keys.map((_, i) => `$${i + 1}`).join(', ');
  const returning = opts.returning || 'id';
  const result = await query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${ph}) RETURNING ${returning}`,
    values
  );
  if (result.error) return result;
  return opts.single === false ? result : { data: result.data[0], error: null };
}

async function update(table, updates, where, opts = {}) {
  const params = [];
  const set   = Object.entries(updates).map(([k, v]) => { params.push(v); return `${k} = $${params.length}`; });
  const cond  = Object.entries(where).map(([k, v])   => { params.push(v); return `${k} = $${params.length}`; });
  const returning = opts.returning || '*';
  const result = await query(
    `UPDATE ${table} SET ${set.join(', ')} WHERE ${cond.join(' AND ')} RETURNING ${returning}`,
    params
  );
  if (result.error) return result;
  return opts.single === false ? result : { data: result.data[0] || null, error: null };
}

async function deleteFrom(table, where) {
  const params = [];
  const clauses = Object.entries(where).map(([k, v]) => { params.push(v); return `${k} = $${params.length}`; });
  return query(`DELETE FROM ${table} WHERE ${clauses.join(' AND ')}`, params);
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return { data: result, error: null };
  } catch (err) {
    await client.query('ROLLBACK');
    return { data: null, error: err.message };
  } finally {
    client.release();
  }
}

function getPoolStats() {
  return { totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount };
}

async function close() { await pool.end(); }

module.exports = { query, select, insert, update, deleteFrom, transaction, getPoolStats, close, pool };
