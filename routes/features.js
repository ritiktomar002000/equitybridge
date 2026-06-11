// routes/features.js — Auto-invest, Watchlist, Notifications, Reviews, Impact, Referrals, Q&A
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ══════════════════════════════════════════════════════════════════
//  AUTO-INVEST
// ══════════════════════════════════════════════════════════════════

// GET /api/features/auto-invest
router.get('/auto-invest', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT * FROM auto_invest_rules WHERE investor_id = $1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ rules: data });
});

// POST /api/features/auto-invest
router.post('/auto-invest', requireAuth, async (req, res) => {
  const { amount, frequency, categories, max_per_business, min_funding_pct, max_equity_pct } = req.body;
  if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum auto-invest amount is $10.' });

  const next = getNextTrigger(frequency);
  const { data, error } = await db.insert('auto_invest_rules', {
    id: uuidv4(), investor_id: req.user.id, amount, frequency: frequency || 'monthly',
    categories: categories || null, max_per_business: max_per_business || 1000,
    min_funding_pct: min_funding_pct || 20, max_equity_pct: max_equity_pct || 30,
    is_active: true, next_trigger: next, created_at: new Date(), updated_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });
  res.status(201).json({ rule: data, message: `Auto-invest of $${amount} set up. Next trigger: ${next.toDateString()}` });
});

// PUT /api/features/auto-invest/:id
router.put('/auto-invest/:id', requireAuth, async (req, res) => {
  const { data: rule } = await db.select('auto_invest_rules', { where: { id: req.params.id }, single: true });
  if (!rule || rule.investor_id !== req.user.id) return res.status(404).json({ error: 'Rule not found.' });
  const allowed = ['amount','frequency','categories','max_per_business','min_funding_pct','max_equity_pct','is_active'];
  const updates = { updated_at: new Date() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  const { data, error } = await db.update('auto_invest_rules', updates, { id: req.params.id }, { returning: '*' });
  if (error) return res.status(500).json({ error });
  res.json({ rule: data });
});

// DELETE /api/features/auto-invest/:id
router.delete('/auto-invest/:id', requireAuth, async (req, res) => {
  await db.update('auto_invest_rules', { is_active: false, updated_at: new Date() }, { id: req.params.id });
  res.json({ message: 'Auto-invest rule deactivated.' });
});

// ══════════════════════════════════════════════════════════════════
//  WATCHLIST
// ══════════════════════════════════════════════════════════════════

router.get('/watchlist', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT w.*, b.name, b.category, b.location_city, b.logo_url,
       o.target_amount, o.amount_raised, o.closes_at, o.status as offering_status,
       ROUND((o.amount_raised/NULLIF(o.target_amount,0))*100,1) as funding_pct
     FROM watchlist w
     JOIN businesses b ON w.business_id = b.id
     LEFT JOIN offerings o ON o.business_id = b.id AND o.status = 'active'
     WHERE w.user_id = $1 ORDER BY w.created_at DESC`, [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ watchlist: data });
});

router.post('/watchlist', requireAuth, async (req, res) => {
  const { business_id, notes } = req.body;
  if (!business_id) return res.status(400).json({ error: 'business_id required.' });
  await db.insert('watchlist', {
    id: uuidv4(), user_id: req.user.id, business_id, notes: notes || null, created_at: new Date()
  }, { returning: 'id' }).catch(() => {});
  res.json({ message: 'Added to watchlist.' });
});

router.delete('/watchlist/:business_id', requireAuth, async (req, res) => {
  await db.deleteFrom('watchlist', { user_id: req.user.id, business_id: req.params.business_id });
  res.json({ message: 'Removed from watchlist.' });
});

// ══════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════

router.get('/notifications', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  const unread = (data || []).filter(n => !n.is_read).length;
  if (error) return res.status(500).json({ error });
  res.json({ notifications: data, unread_count: unread });
});

router.post('/notifications/read-all', requireAuth, async (req, res) => {
  await db.query(
    `UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id]
  );
  res.json({ message: 'All notifications marked as read.' });
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  await db.update('notifications', { is_read: true, read_at: new Date() },
    { id: req.params.id, user_id: req.user.id });
  res.json({ message: 'Marked as read.' });
});

// ══════════════════════════════════════════════════════════════════
//  BUSINESS REVIEWS
// ══════════════════════════════════════════════════════════════════

router.get('/reviews/:business_id', async (req, res) => {
  const { data, error } = await db.query(
    `SELECT r.id, r.rating, r.title, r.content, r.reviewer_type, r.helpful_count,
       r.is_verified, r.created_at, u.first_name, LEFT(u.last_name,1) as last_initial
     FROM business_reviews r JOIN users u ON r.reviewer_id = u.id
     WHERE r.business_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
    [req.params.business_id]
  );
  if (error) return res.status(500).json({ error });

  const avg = (data||[]).reduce((s,r) => s + r.rating, 0) / (data?.length || 1);
  res.json({ reviews: data, average_rating: Math.round(avg * 10) / 10, total: data?.length });
});

router.post('/reviews', requireAuth, async (req, res) => {
  const { business_id, rating, title, content, visit_date } = req.body;
  if (!business_id || !rating) return res.status(400).json({ error: 'business_id and rating required.' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5.' });

  // Check if investor
  const { data: inv } = await db.query(
    `SELECT id FROM investments WHERE investor_id = $1 AND business_id = $2 AND status = 'completed' LIMIT 1`,
    [req.user.id, business_id]
  );
  const reviewer_type = inv?.length ? 'investor' : 'customer';

  const { data, error } = await db.insert('business_reviews', {
    id: uuidv4(), business_id, reviewer_id: req.user.id, reviewer_type,
    rating, title: title || null, content: content || null,
    visit_date: visit_date || null, is_verified: reviewer_type === 'investor',
    created_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(400).json({ error: error.includes('unique') ? 'You already reviewed this business.' : error });
  res.status(201).json({ review: data });
});

// ══════════════════════════════════════════════════════════════════
//  IMPACT METRICS
// ══════════════════════════════════════════════════════════════════

router.get('/impact/:business_id', async (req, res) => {
  const { data, error } = await db.query(
    `SELECT * FROM impact_metrics WHERE business_id = $1 ORDER BY reported_at DESC LIMIT 8`,
    [req.params.business_id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ metrics: data });
});

router.post('/impact', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const { business_id, period_label, jobs_created, jobs_retained,
          local_spend_pct, revenue_growth, community_events } = req.body;

  const { data, error } = await db.insert('impact_metrics', {
    id: uuidv4(), business_id, period_label,
    jobs_created: jobs_created || 0, jobs_retained: jobs_retained || 0,
    local_spend_pct: local_spend_pct || null, revenue_growth: revenue_growth || null,
    community_events: community_events || 0, reported_at: new Date(), created_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });

  // Update business total_jobs
  await db.query(
    `UPDATE businesses SET total_jobs = total_jobs + $1 WHERE id = $2`,
    [jobs_created || 0, business_id]
  );
  res.status(201).json({ metric: data });
});

// GET /api/features/platform-impact — totals across whole platform
router.get('/platform-impact', async (_req, res) => {
  const { data, error } = await db.query(`
    SELECT
      COALESCE(SUM(im.jobs_created),0)   as total_jobs_created,
      COALESCE(SUM(im.jobs_retained),0)  as total_jobs_retained,
      COUNT(DISTINCT im.business_id)     as businesses_impacted,
      COALESCE(SUM(o.amount_raised),0)   as total_capital_deployed,
      COUNT(DISTINCT i.investor_id)      as total_investors,
      COUNT(DISTINCT b.location_city)    as cities_reached
    FROM impact_metrics im
    JOIN businesses b ON im.business_id = b.id
    LEFT JOIN offerings o ON o.business_id = b.id AND o.status IN ('funded','active')
    LEFT JOIN investments i ON i.business_id = b.id AND i.status = 'completed'
  `);
  if (error) return res.status(500).json({ error });
  res.json({ impact: data?.[0] });
});

// ══════════════════════════════════════════════════════════════════
//  REFERRALS
// ══════════════════════════════════════════════════════════════════

router.get('/referrals', requireAuth, async (req, res) => {
  const { data: referrals } = await db.query(
    `SELECT r.*, u.first_name, u.last_name, u.email FROM referrals r
     LEFT JOIN users u ON r.referred_id = u.id
     WHERE r.referrer_id = $1 ORDER BY r.created_at DESC`,
    [req.user.id]
  );
  const earned = (referrals||[]).filter(r => r.reward_paid).reduce((s,r) => s + r.reward_amount, 0);
  const code = req.user.referral_code;
  res.json({ referrals, total_earned: earned, referral_code: code,
    referral_link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}?ref=${code}` });
});

router.post('/referrals/apply', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Referral code required.' });
  if (req.user.referred_by) return res.status(400).json({ error: 'You already used a referral code.' });

  const { data: referral } = await db.select('referrals', { where: { referral_code: code }, single: true });
  if (!referral || referral.referrer_id === req.user.id) return res.status(404).json({ error: 'Invalid referral code.' });

  await db.update('referrals', { referred_id: req.user.id, status: 'signed_up', updated_at: new Date() }, { referral_code: code });
  await db.update('users', { referred_by: referral.referrer_id, updated_at: new Date() }, { id: req.user.id });
  res.json({ message: 'Referral code applied! Your referrer will earn $25 when you make your first investment.' });
});

// ══════════════════════════════════════════════════════════════════
//  OFFERING Q&A
// ══════════════════════════════════════════════════════════════════

router.get('/qa/:offering_id', async (req, res) => {
  const { data, error } = await db.query(
    `SELECT q.id, q.question, q.answer, q.upvotes, q.answered_at, q.created_at,
       u.first_name, LEFT(u.last_name,1) as last_initial,
       a.first_name as answerer_first, a.last_name as answerer_last
     FROM offering_qa q
     JOIN users u ON q.user_id = u.id
     LEFT JOIN users a ON q.answered_by = a.id
     WHERE q.offering_id = $1 AND q.is_public = TRUE ORDER BY q.upvotes DESC, q.created_at ASC`,
    [req.params.offering_id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ questions: data });
});

router.post('/qa', requireAuth, async (req, res) => {
  const { offering_id, question } = req.body;
  if (!offering_id || !question) return res.status(400).json({ error: 'offering_id and question required.' });
  const { data, error } = await db.insert('offering_qa', {
    id: uuidv4(), offering_id, user_id: req.user.id,
    question, is_public: true, created_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });
  res.status(201).json({ question: data });
});

router.post('/qa/:id/answer', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ error: 'Answer required.' });
  await db.update('offering_qa',
    { answer, answered_by: req.user.id, answered_at: new Date() },
    { id: req.params.id }
  );
  res.json({ message: 'Answer posted.' });
});

// ══════════════════════════════════════════════════════════════════
//  BUSINESS UPDATES
// ══════════════════════════════════════════════════════════════════

router.get('/updates/:business_id', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT u.*, usr.first_name, usr.last_name FROM business_updates u
     JOIN users usr ON u.author_id = usr.id
     WHERE u.business_id = $1 AND (u.is_public = TRUE OR EXISTS (
       SELECT 1 FROM investments i WHERE i.business_id = u.business_id AND i.investor_id = $2 AND i.status = 'completed'
     )) ORDER BY u.created_at DESC LIMIT 20`,
    [req.params.business_id, req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ updates: data });
});

router.post('/updates', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const { business_id, title, content, update_type, media_urls, is_public, offering_id } = req.body;
  if (!business_id || !title || !content) return res.status(400).json({ error: 'business_id, title, content required.' });

  const { data: biz } = await db.select('businesses', { where: { id: business_id }, single: true });
  if (!biz || biz.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const { data, error } = await db.insert('business_updates', {
    id: uuidv4(), business_id, offering_id: offering_id || null, author_id: req.user.id,
    title, content, update_type: update_type || 'general',
    media_urls: media_urls ? JSON.stringify(media_urls) : null,
    is_public: is_public ?? false, created_at: new Date(), updated_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });

  // Notify all investors
  const { data: investors } = await db.query(
    `SELECT DISTINCT i.investor_id FROM investments i WHERE i.business_id = $1 AND i.status = 'completed'`,
    [business_id]
  );
  for (const inv of (investors || [])) {
    await db.insert('notifications', {
      id: uuidv4(), user_id: inv.investor_id, type: 'business_update',
      title: `Update from ${biz.name}`, message: title,
      data: JSON.stringify({ business_id, update_id: data.id }), created_at: new Date(),
    }, { returning: 'id' }).catch(() => {});
  }

  res.status(201).json({ update: data, notified: investors?.length || 0 });
});

// ══════════════════════════════════════════════════════════════════
//  INVESTMENT CALCULATOR
// ══════════════════════════════════════════════════════════════════

router.post('/calculator', async (req, res) => {
  const { investment_amount, equity_percent, target_amount, annual_growth_pct = 15, years = 5 } = req.body;
  if (!investment_amount || !equity_percent || !target_amount) {
    return res.status(400).json({ error: 'investment_amount, equity_percent, target_amount required.' });
  }

  const ownership = (investment_amount / target_amount) * equity_percent;
  const projections = [];
  let runningValue = investment_amount;

  for (let y = 1; y <= years; y++) {
    const businessValue  = target_amount * Math.pow(1 + annual_growth_pct / 100, y);
    const stakeValue     = (ownership / 100) * businessValue;
    const totalReturn    = stakeValue - investment_amount;
    const returnPct      = (totalReturn / investment_amount) * 100;
    projections.push({
      year: y,
      business_value:  Math.round(businessValue),
      stake_value:     Math.round(stakeValue),
      total_return:    Math.round(totalReturn),
      return_pct:      Math.round(returnPct * 10) / 10,
    });
    runningValue = stakeValue;
  }

  res.json({
    input: { investment_amount, equity_percent, target_amount, annual_growth_pct, years },
    ownership_pct: Math.round(ownership * 10000) / 10000,
    projections,
    best_case:  projections[projections.length - 1],
    disclaimer: 'Projections are estimates only. Past performance does not guarantee future results. Investments carry risk including total loss.'
  });
});

// ══════════════════════════════════════════════════════════════════
//  NEARBY BUSINESSES (location-based)
// ══════════════════════════════════════════════════════════════════

router.get('/nearby', async (req, res) => {
  const { lat, lng, radius_km = 10, limit = 10 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required.' });

  // Haversine formula in SQL
  const { data, error } = await db.query(`
    SELECT b.*, o.target_amount, o.amount_raised, o.equity_percent, o.min_investment, o.closes_at,
      ROUND((o.amount_raised / NULLIF(o.target_amount,0)) * 100, 1) as funding_pct,
      ROUND(
        6371 * acos(
          cos(radians($1)) * cos(radians(b.latitude)) *
          cos(radians(b.longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(b.latitude))
        )::numeric, 1
      ) as distance_km
    FROM businesses b
    JOIN offerings o ON o.business_id = b.id AND o.status = 'active'
    WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
      AND b.status = 'approved'
      AND 6371 * acos(
        cos(radians($1)) * cos(radians(b.latitude)) *
        cos(radians(b.longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(b.latitude))
      ) < $3
    ORDER BY distance_km ASC LIMIT $4`,
    [parseFloat(lat), parseFloat(lng), parseFloat(radius_km), parseInt(limit)]
  );
  if (error) return res.status(500).json({ error });
  res.json({ businesses: data, center: { lat, lng }, radius_km });
});

// ── HELPER ────────────────────────────────────────────────────────
function getNextTrigger(frequency) {
  const d = new Date();
  if (frequency === 'weekly')    d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly')  d.setMonth(d.getMonth() + 1);
  else if (frequency === 'quarterly') d.setMonth(d.getMonth() + 3);
  return d;
}

module.exports = router;
