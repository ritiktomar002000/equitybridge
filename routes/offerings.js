// routes/offerings.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { checkOfferingLimit, generateRiskFactors } = require('../lib/regcf');

const router = express.Router();

// GET /api/offerings — public active offerings
router.get('/', async (req, res) => {
  const { category, limit = 20, offset = 0, status = 'active', sort = 'created_at' } = req.query;

  let sql = `
    SELECT o.*,
      b.name as business_name, b.category, b.location_city, b.location_state,
      b.logo_url, b.annual_revenue, b.verified,
      ROUND((o.amount_raised / NULLIF(o.target_amount,0)) * 100, 1) as funding_percent
    FROM offerings o
    JOIN businesses b ON o.business_id = b.id
    WHERE o.status = $1`;
  const params = [status];

  if (category) { params.push(category); sql += ` AND b.category = $${params.length}`; }

  const validSorts = { created_at:'o.created_at', amount_raised:'o.amount_raised', closes_at:'o.closes_at' };
  sql += ` ORDER BY ${validSorts[sort] || 'o.created_at'} DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(Number(limit), Number(offset));

  const { data, error } = await db.query(sql, params);
  if (error) return res.status(500).json({ error });
  res.json({ offerings: data });
});

// GET /api/offerings/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await db.query(
    `SELECT o.*,
       b.name as business_name, b.category, b.description as business_description,
       b.location_city, b.location_state, b.website, b.founded_year,
       b.annual_revenue, b.monthly_revenue, b.logo_url, b.pitch_deck_url, b.verified,
       ROUND((o.amount_raised / NULLIF(o.target_amount,0)) * 100, 1) as funding_percent,
       (SELECT COUNT(*) FROM investments i WHERE i.offering_id = o.id AND i.status IN ('completed','escrowed')) as investor_count
     FROM offerings o
     JOIN businesses b ON o.business_id = b.id
     WHERE o.id = $1`, [req.params.id]
  );
  if (error || !data?.length) return res.status(404).json({ error: 'Offering not found.' });
  res.json({ offering: data[0] });
});

// POST /api/offerings — owner creates offering
router.post('/', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const {
    business_id, equity_percent, target_amount, min_investment = 250,
    max_investment, valuation, use_of_proceeds, opens_at, closes_at
  } = req.body;

  if (!business_id || !equity_percent || !target_amount || !use_of_proceeds || !closes_at) {
    return res.status(400).json({ error: 'business_id, equity_percent, target_amount, use_of_proceeds, closes_at are required.' });
  }

  // Verify ownership
  const { data: biz } = await db.select('businesses', { where: { id: business_id }, single: true });
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You do not own this business.' });
  }
  if (biz.status !== 'approved') {
    return res.status(400).json({ error: 'Business must be approved before creating an offering.' });
  }

  // Reg CF offering cap check
  const capCheck = await checkOfferingLimit(business_id, target_amount);
  if (!capCheck.allowed) return res.status(400).json({ error: capCheck.error });

  const risk_factors = generateRiskFactors(biz.name);

  const { data, error } = await db.insert('offerings', {
    id:              uuidv4(),
    business_id,
    equity_percent,
    target_amount,
    min_investment,
    max_investment:  max_investment || null,
    valuation:       valuation || null,
    use_of_proceeds,
    risk_factors:    JSON.stringify(risk_factors),
    opens_at:        opens_at || new Date(),
    closes_at,
    amount_raised:   0,
    status:          'draft',
    offering_type:   'reg_cf',
    created_at:      new Date(),
    updated_at:      new Date(),
  }, { returning: '*' });

  if (error) return res.status(500).json({ error });
  res.status(201).json({ offering: data, message: 'Offering created. Submit for admin review.' });
});

// PATCH /api/offerings/:id/publish — admin approves and makes live
router.patch('/:id/publish', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.update('offerings',
    { status: 'active', published_at: new Date(), updated_at: new Date() },
    { id: req.params.id }, { returning: '*' }
  );
  if (error) return res.status(500).json({ error });
  res.json({ offering: data, message: 'Offering is now live.' });
});

// PATCH /api/offerings/:id/close — admin closes offering
router.patch('/:id/close', requireAuth, requireRole('admin'), async (req, res) => {
  const { data: offering } = await db.select('offerings', { where: { id: req.params.id }, single: true });
  if (!offering) return res.status(404).json({ error: 'Offering not found.' });

  const funded = offering.amount_raised >= offering.target_amount;
  const newStatus = funded ? 'funded' : 'closed';

  const { data, error } = await db.update('offerings',
    { status: newStatus, closed_at: new Date(), updated_at: new Date() },
    { id: req.params.id }, { returning: '*' }
  );
  if (error) return res.status(500).json({ error });

  // If campaign failed, trigger escrow returns
  if (!funded) {
    await db.query(
      `UPDATE escrow_transactions SET status = 'returned', return_reason = 'campaign_failed', returned_at = NOW()
       WHERE offering_id = $1 AND status = 'deposited'`,
      [req.params.id]
    );
  }

  res.json({ offering: data, funded, message: `Offering ${newStatus}.` });
});

// GET /api/offerings/:id/investors — owner/admin sees investors
router.get('/:id/investors', requireAuth, async (req, res) => {
  const { data: offering } = await db.query(
    `SELECT o.*, b.owner_id FROM offerings o JOIN businesses b ON o.business_id = b.id WHERE o.id = $1`,
    [req.params.id]
  );
  if (!offering?.length) return res.status(404).json({ error: 'Offering not found.' });
  if (offering[0].owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { data, error } = await db.query(
    `SELECT i.id, i.amount, i.equity_share, i.status, i.created_at,
       u.first_name, u.last_name, u.email, u.kyc_status
     FROM investments i JOIN users u ON i.investor_id = u.id
     WHERE i.offering_id = $1 AND i.status IN ('completed','escrowed')
     ORDER BY i.created_at DESC`,
    [req.params.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ investors: data });
});

module.exports = router;
