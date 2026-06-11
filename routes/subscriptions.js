// routes/subscriptions.js — investor subscription confirmations
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const { offering_id, investment_id, amount, equity_share } = req.body;
  const { data, error } = await db.insert('subscriptions', {
    id: uuidv4(), investor_id: req.user.id, offering_id, investment_id,
    amount, equity_share, status: 'active', created_at: new Date(), updated_at: new Date()
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });
  res.status(201).json({ subscription: data });
});

router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT s.*, b.name as business_name, o.equity_percent FROM subscriptions s
     JOIN offerings o ON s.offering_id = o.id JOIN businesses b ON o.business_id = b.id
     WHERE s.investor_id = $1 ORDER BY s.created_at DESC`, [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ subscriptions: data });
});

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.query(
    `SELECT s.*, u.email, b.name as business_name FROM subscriptions s
     JOIN users u ON s.investor_id = u.id
     JOIN offerings o ON s.offering_id = o.id JOIN businesses b ON o.business_id = b.id
     ORDER BY s.created_at DESC LIMIT 100`
  );
  if (error) return res.status(500).json({ error });
  res.json({ subscriptions: data });
});

module.exports = router;
