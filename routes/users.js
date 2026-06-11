// routes/users.js
const express = require('express');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users/dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const [portfolioRes, distributionsRes, recentInvRes] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('escrowed','completed')) as active_investments,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('escrowed','completed')), 0) as total_invested,
        COALESCE(SUM(equity_share) FILTER (WHERE status IN ('escrowed','completed')), 0) as total_equity
      FROM investments WHERE investor_id = $1`, [userId]),

    db.query(`SELECT COALESCE(SUM(amount),0) as total FROM distributions WHERE investor_id = $1`, [userId]),

    db.query(`
      SELECT i.id, i.amount, i.equity_share, i.status, i.created_at,
        b.name as business_name, b.category, b.logo_url, b.location_city
      FROM investments i
      JOIN businesses b ON i.business_id = b.id
      WHERE i.investor_id = $1 ORDER BY i.created_at DESC LIMIT 5`, [userId]),
  ]);

  const stats = portfolioRes.data?.[0] || {};
  res.json({
    stats: {
      active_investments: parseInt(stats.active_investments || 0),
      total_invested:     parseFloat(stats.total_invested   || 0),
      total_equity_pct:   parseFloat(stats.total_equity     || 0),
      total_distributions:parseFloat(distributionsRes.data?.[0]?.total || 0),
    },
    recent_investments: recentInvRes.data || [],
  });
});

// GET /api/users/profile
router.get('/profile', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/users/profile
router.put('/profile', requireAuth, async (req, res) => {
  const allowed = ['first_name','last_name','phone','date_of_birth',
                   'address_line1','address_city','address_state','address_zip'];
  const updates = { updated_at: new Date() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data, error } = await db.update('users', updates, { id: req.user.id },
    { returning: 'id,email,first_name,last_name,role,phone,kyc_status,is_accredited' });
  if (error) return res.status(500).json({ error });
  res.json({ user: data });
});

// GET /api/users/distributions
router.get('/distributions', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT d.*, b.name as business_name, b.logo_url
     FROM distributions d
     JOIN businesses b ON d.business_id = b.id
     WHERE d.investor_id = $1 ORDER BY d.paid_at DESC`,
    [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ distributions: data });
});

// GET /api/users — admin: list all users
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { role, kyc_status, limit = 50, offset = 0 } = req.query;
  let sql = `SELECT id, email, first_name, last_name, role, kyc_status, is_accredited,
               created_at, last_login, is_suspended
             FROM users WHERE 1=1`;
  const params = [];

  if (role)       { params.push(role);       sql += ` AND role = $${params.length}`; }
  if (kyc_status) { params.push(kyc_status); sql += ` AND kyc_status = $${params.length}`; }

  params.push(Number(limit), Number(offset));
  sql += ` ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;

  const { data, error } = await db.query(sql, params);
  if (error) return res.status(500).json({ error });
  res.json({ users: data });
});

// PATCH /api/users/:id/suspend — admin
router.patch('/:id/suspend', requireAuth, requireRole('admin'), async (req, res) => {
  const { suspended, reason } = req.body;
  await db.update('users',
    { is_suspended: !!suspended, suspension_reason: reason || null, updated_at: new Date() },
    { id: req.params.id }
  );
  res.json({ message: `User ${suspended ? 'suspended' : 'unsuspended'}.` });
});

module.exports = router;
