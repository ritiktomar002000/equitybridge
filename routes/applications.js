// routes/applications.js — Business applications (Step 1 of Reg CF deal flow)
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

router.post('/', requireAuth, requireRole('owner','admin'), async (req, res) => {
  const {
    business_name, category, description, location,
    entity_documents, ownership_details, financials,
    business_licenses, lease_information, business_plan,
    debt_information, litigation_history
  } = req.body;

  if (!business_name || !category) return res.status(400).json({ error: 'business_name and category are required.' });

  const appId = uuidv4();
  const reviewId = uuidv4();

  const { data: app, error } = await db.insert('applications', {
    id:                   appId,
    user_id:              req.user.id,
    business_name,
    category,
    description:          description || null,
    location:             JSON.stringify(location || {}),
    entity_documents:     JSON.stringify(entity_documents || {}),
    ownership_details:    JSON.stringify(ownership_details || {}),
    financials:           JSON.stringify(financials || {}),
    business_licenses:    JSON.stringify(business_licenses || []),
    lease_information:    JSON.stringify(lease_information || {}),
    business_plan:        JSON.stringify(business_plan || {}),
    debt_information:     JSON.stringify(debt_information || {}),
    litigation_history:   JSON.stringify(litigation_history || {}),
    status:               'submitted',
    submitted_at:         new Date(),
    created_at:           new Date(),
    updated_at:           new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });

  const { data: review } = await db.insert('compliance_reviews', {
    id:             reviewId,
    application_id: appId,
    status:         'pending',
    created_at:     new Date(),
    updated_at:     new Date(),
  }, { returning: '*' });

  res.status(201).json({ message: 'Application submitted.', application: app, compliance_review: review });
});

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query;
  let sql = `SELECT a.*, u.email as owner_email, u.first_name, u.last_name
             FROM applications a JOIN users u ON a.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); sql += ` AND a.status = $${params.length}`; }
  params.push(Number(limit), Number(offset));
  sql += ` ORDER BY a.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
  const { data, error } = await db.query(sql, params);
  if (error) return res.status(500).json({ error });
  res.json({ applications: data });
});

router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await db.query(
    `SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]
  );
  if (error) return res.status(500).json({ error });
  res.json({ applications: data });
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data: rows, error } = await db.query(
    `SELECT a.*, cr.* FROM applications a LEFT JOIN compliance_reviews cr ON cr.application_id = a.id WHERE a.id = $1`,
    [req.params.id]
  );
  if (error || !rows?.length) return res.status(404).json({ error: 'Application not found.' });
  if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied.' });
  res.json({ application: rows[0] });
});

module.exports = router;
