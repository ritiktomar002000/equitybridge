// routes/reports.js — admin platform analytics
const express = require('express');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/reports/platform — overall platform stats
router.get('/platform', requireAuth, requireRole('admin'), async (req, res) => {
  const [users, investments, offerings, escrow] = await Promise.all([
    db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE role='investor') as investors,
              COUNT(*) FILTER (WHERE role='owner') as owners,
              COUNT(*) FILTER (WHERE kyc_status='approved') as kyc_approved FROM users`),
    db.query(`SELECT COUNT(*) as total,
              COALESCE(SUM(amount) FILTER (WHERE status IN ('escrowed','completed')), 0) as total_amount,
              COUNT(*) FILTER (WHERE status='completed') as completed,
              COUNT(*) FILTER (WHERE status='cancelled') as cancelled FROM investments`),
    db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='active') as active,
              COUNT(*) FILTER (WHERE status='funded') as funded,
              COALESCE(SUM(amount_raised),0) as total_raised FROM offerings`),
    db.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE status='deposited'),0) as in_escrow,
              COALESCE(SUM(amount) FILTER (WHERE status='released'),0) as released FROM escrow_transactions`),
  ]);

  res.json({
    users:       users.data?.[0],
    investments: investments.data?.[0],
    offerings:   offerings.data?.[0],
    escrow:      escrow.data?.[0],
    generated_at: new Date(),
  });
});

// GET /api/reports/offerings — per-offering performance
router.get('/offerings', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.query(`
    SELECT o.id, o.target_amount, o.amount_raised, o.status,
      ROUND((o.amount_raised / NULLIF(o.target_amount,0)) * 100, 1) as funding_pct,
      b.name as business_name, b.category,
      (SELECT COUNT(*) FROM investments i WHERE i.offering_id = o.id AND i.status = 'completed') as investor_count,
      o.opens_at, o.closes_at, o.created_at
    FROM offerings o JOIN businesses b ON o.business_id = b.id
    ORDER BY o.created_at DESC
  `);
  if (error) return res.status(500).json({ error });
  res.json({ offerings: data });
});

// GET /api/reports/investors — investor activity report
router.get('/investors', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.query(`
    SELECT u.id, u.email, u.first_name, u.last_name, u.kyc_status, u.is_accredited,
      COUNT(i.id) as investment_count,
      COALESCE(SUM(i.amount) FILTER (WHERE i.status IN ('escrowed','completed')), 0) as total_invested,
      u.created_at, u.last_login
    FROM users u
    LEFT JOIN investments i ON i.investor_id = u.id
    WHERE u.role = 'investor'
    GROUP BY u.id ORDER BY total_invested DESC LIMIT 100
  `);
  if (error) return res.status(500).json({ error });
  res.json({ investors: data });
});

// GET /api/reports/compliance — compliance status overview
router.get('/compliance', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE kyc_status = 'pending')   as kyc_pending,
      COUNT(*) FILTER (WHERE kyc_status = 'submitted') as kyc_submitted,
      COUNT(*) FILTER (WHERE kyc_status = 'approved')  as kyc_approved,
      COUNT(*) FILTER (WHERE kyc_status = 'rejected')  as kyc_rejected,
      COUNT(*) FILTER (WHERE is_accredited = true)     as accredited
    FROM users WHERE role = 'investor'
  `);
  if (error) return res.status(500).json({ error });
  res.json({ compliance: data?.[0] });
});

module.exports = router;
