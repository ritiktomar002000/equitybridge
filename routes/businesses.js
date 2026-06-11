// routes/businesses.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/businesses — public listing
router.get('/', async (req, res) => {
  const { category, city, state, limit = 20, offset = 0, search } = req.query;

  let sql = `SELECT b.*, 
    (SELECT COUNT(*) FROM offerings o WHERE o.business_id = b.id AND o.status = 'active') as active_offerings
    FROM businesses b WHERE b.status = 'approved'`;
  const params = [];

  if (category) { params.push(category);      sql += ` AND b.category = $${params.length}`; }
  if (city)     { params.push(city);          sql += ` AND LOWER(b.location_city) = LOWER($${params.length})`; }
  if (state)    { params.push(state);         sql += ` AND LOWER(b.location_state) = LOWER($${params.length})`; }
  if (search)   { params.push(`%${search}%`); sql += ` AND (LOWER(b.name) LIKE LOWER($${params.length}) OR LOWER(b.description) LIKE LOWER($${params.length}))`; }

  params.push(Number(limit), Number(offset));
  sql += ` ORDER BY b.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { data, error } = await db.query(sql, params);
  if (error) return res.status(500).json({ error });
  res.json({ businesses: data });
});

// GET /api/businesses/mine — owner's businesses
router.get('/mine', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const { data, error } = await db.query(
    `SELECT b.*, 
      (SELECT COUNT(*) FROM offerings o WHERE o.business_id = b.id) as offering_count,
      (SELECT SUM(i.amount) FROM investments i 
       JOIN offerings o ON i.offering_id = o.id WHERE o.business_id = b.id AND i.status = 'completed') as total_raised
     FROM businesses b WHERE b.owner_id = $1 ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ businesses: data });
});

// GET /api/businesses/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await db.query(
    `SELECT b.*, u.first_name || ' ' || u.last_name AS owner_name
     FROM businesses b
     JOIN users u ON b.owner_id = u.id
     WHERE b.id = $1`,
    [req.params.id]
  );
  if (error || !data?.length) return res.status(404).json({ error: 'Business not found.' });
  res.json({ business: data[0] });
});

// POST /api/businesses — owner creates (requires application flow)
router.post('/', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  const {
    name, category, description, location_address, location_city,
    location_state, location_zip, website, founded_year,
    annual_revenue, monthly_revenue, employee_count
  } = req.body;

  if (!name || !category || !location_city || !location_state) {
    return res.status(400).json({ error: 'name, category, location_city, location_state are required.' });
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g,'')
    + '-' + Date.now().toString(36);

  const { data, error } = await db.insert('businesses', {
    id:               uuidv4(),
    owner_id:         req.user.id,
    name,
    slug,
    category,
    description:      description || null,
    location_address: location_address || null,
    location_city,
    location_state,
    location_zip:     location_zip || null,
    website:          website || null,
    founded_year:     founded_year || null,
    annual_revenue:   annual_revenue || null,
    monthly_revenue:  monthly_revenue || null,
    employee_count:   employee_count || null,
    status:           'pending',
    created_at:       new Date(),
    updated_at:       new Date(),
  }, { returning: '*' });

  if (error) return res.status(500).json({ error });
  res.status(201).json({ business: data, message: 'Business submitted for review.' });
});

// PUT /api/businesses/:id
router.put('/:id', requireAuth, async (req, res) => {
  const { data: biz } = await db.select('businesses', { where: { id: req.params.id }, single: true });
  if (!biz) return res.status(404).json({ error: 'Business not found.' });
  if (biz.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied.' });
  }

  const allowed = ['name','description','website','location_address','location_city',
                   'location_state','location_zip','annual_revenue','monthly_revenue',
                   'employee_count','logo_url','pitch_deck_url'];
  const updates = { updated_at: new Date() };
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data, error } = await db.update('businesses', updates, { id: req.params.id }, { returning: '*' });
  if (error) return res.status(500).json({ error });
  res.json({ business: data });
});

// PATCH /api/businesses/:id/approve — admin only
router.patch('/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.update('businesses',
    { status: 'approved', approved_at: new Date(), updated_at: new Date() },
    { id: req.params.id }, { returning: '*' }
  );
  if (error) return res.status(500).json({ error });
  res.json({ business: data, message: 'Business approved.' });
});

// PATCH /api/businesses/:id/reject — admin only
router.patch('/:id/reject', requireAuth, requireRole('admin'), async (req, res) => {
  const { reason } = req.body;
  const { data, error } = await db.update('businesses',
    { status: 'rejected', rejection_reason: reason || null, updated_at: new Date() },
    { id: req.params.id }, { returning: '*' }
  );
  if (error) return res.status(500).json({ error });
  res.json({ business: data });
});

module.exports = router;
