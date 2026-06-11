// routes/securities.js — securities issuance records
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

router.post('/issue', requireAuth, requireRole('admin'), async (req, res) => {
  const { investment_id, investor_id, business_id, offering_id, equity_share, certificate_number } = req.body;
  const { data, error } = await db.insert('securities', {
    id: uuidv4(), investment_id, investor_id, business_id, offering_id,
    equity_share, certificate_number: certificate_number || `CERT-${Date.now()}`,
    issued_at: new Date(), status: 'active', created_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });
  res.status(201).json({ security: data });
});

router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT s.*, b.name as business_name FROM securities s
     JOIN businesses b ON s.business_id = b.id
     WHERE s.investor_id = $1 ORDER BY s.issued_at DESC`, [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ securities: data });
});

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.query(
    `SELECT s.*, u.email, b.name as business_name FROM securities s
     JOIN users u ON s.investor_id = u.id JOIN businesses b ON s.business_id = b.id
     ORDER BY s.issued_at DESC LIMIT 100`
  );
  if (error) return res.status(500).json({ error });
  res.json({ securities: data });
});

module.exports = router;
