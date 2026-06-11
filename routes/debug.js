// routes/debug.js — diagnostics (auto-disabled in production)
const express = require('express');
const db = require('../lib/db');
const router = express.Router();

router.get('/', async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found.' });
  }

  const checks = {};

  // 1. DB connection
  try {
    const r = await db.query('SELECT version() as v');
    checks.db_connected = !r.error;
    checks.db_version   = r.data?.[0]?.v?.split(' ').slice(0, 2).join(' ');
  } catch (e) {
    checks.db_connected = false;
    checks.db_error     = e.message;
  }

  // 2. Tables
  const tables = [
    'users', 'businesses', 'offerings', 'investments',
    'applications', 'compliance_reviews', 'escrow_transactions',
    'payments', 'payment_intents', 'kyc_documents',
    'securities', 'subscriptions', 'distributions',
    'notifications', 'watchlist', 'business_reviews',
    'secondary_listings', 'auto_invest_rules', 'business_updates',
    'impact_metrics', 'referrals', 'offering_qa'
  ];

  checks.tables = {};
  for (const t of tables) {
    try {
      const r = await db.query(`SELECT COUNT(*) as n FROM ${t}`);
      checks.tables[t] = { exists: true, rows: parseInt(r.data?.[0]?.n || 0) };
    } catch {
      checks.tables[t] = { exists: false };
    }
  }

  // 3. Env vars (values masked)
  checks.env = {
    DB_HOST:     process.env.DB_HOST     || '❌ MISSING',
    DB_PORT:     process.env.DB_PORT     || '❌ MISSING',
    DB_NAME:     process.env.DB_NAME     || '❌ MISSING',
    DB_USER:     process.env.DB_USER     || '❌ MISSING',
    DB_PASSWORD: process.env.DB_PASSWORD ? '✅ set' : '❌ MISSING',
    JWT_SECRET:  process.env.JWT_SECRET  ? '✅ set' : '❌ MISSING',
    NODE_ENV:    process.env.NODE_ENV    || 'development',
  };

  const missing = Object.entries(checks.tables).filter(([, v]) => !v.exists).map(([k]) => k);
  checks.status = checks.db_connected && missing.length === 0 ? '✅ All good' : '❌ Issues found';
  checks.action = !checks.db_connected
    ? 'Check DB_HOST, DB_PORT, DB_PASSWORD in your .env file'
    : missing.length > 0
      ? `Run: npm run migrate   (missing tables: ${missing.join(', ')})`
      : 'None needed — everything looks good!';

  res.json(checks);
});

module.exports = router;
