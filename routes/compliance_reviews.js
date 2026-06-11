// routes/compliance_reviews.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// GET /api/compliance-reviews
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await db.query(
    `SELECT cr.*, a.business_name, a.category, u.email as owner_email
     FROM compliance_reviews cr
     JOIN applications a ON cr.application_id = a.id
     JOIN users u ON a.user_id = u.id
     ORDER BY cr.created_at DESC LIMIT 50`
  );
  if (error) return res.status(500).json({ error });
  res.json({ reviews: data });
});

// PUT /api/compliance-reviews/:id — admin submits review decision
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const {
    entity_verification, ownership_verification, financial_review,
    license_verification, lease_verification, fraud_risk_assessment,
    findings, recommendations, status
  } = req.body;

  if (!['approved','rejected','needs_info'].includes(status)) {
    return res.status(400).json({ error: "status must be approved, rejected, or needs_info." });
  }

  const { data: review, error: revErr } = await db.update('compliance_reviews', {
    entity_verification:    entity_verification ?? false,
    ownership_verification: ownership_verification ?? false,
    financial_review:       financial_review ?? false,
    license_verification:   license_verification ?? false,
    lease_verification:     lease_verification ?? false,
    fraud_risk_assessment:  fraud_risk_assessment || 'medium',
    findings:               findings || null,
    recommendations:        recommendations || null,
    reviewed_by:            req.user.id,
    reviewed_at:            new Date(),
    status,
    updated_at:             new Date(),
  }, { id: req.params.id }, { returning: '*' });
  if (revErr) return res.status(500).json({ error: revErr });

  // If approved → auto-create business
  if (status === 'approved') {
    const { data: appRows } = await db.query(
      `SELECT * FROM applications WHERE id = (SELECT application_id FROM compliance_reviews WHERE id = $1)`,
      [req.params.id]
    );
    const app = appRows?.[0];
    if (app) {
      const loc = typeof app.location === 'string' ? JSON.parse(app.location) : app.location;
      const fin = typeof app.financials === 'string' ? JSON.parse(app.financials) : app.financials;
      const slug = app.business_name.toLowerCase().replace(/[^a-z0-9]+/g,'-') + '-' + Date.now().toString(36);

      const { data: biz } = await db.insert('businesses', {
        id:              uuidv4(),
        owner_id:        app.user_id,
        application_id:  app.id,
        name:            app.business_name,
        slug,
        category:        app.category,
        description:     app.description,
        location_city:   loc?.city || '',
        location_state:  loc?.state || '',
        location_address:loc?.address || null,
        annual_revenue:  fin?.annualRevenue || null,
        status:          'approved',
        verified:        true,
        created_at:      new Date(),
        updated_at:      new Date(),
      }, { returning: '*' });

      await db.update('applications', { status: 'approved', updated_at: new Date() }, { id: app.id });
      return res.json({ message: 'Review approved and business created.', review, business: biz });
    }
  }

  if (status === 'rejected') {
    await db.query(
      `UPDATE applications SET status = 'rejected', updated_at = NOW()
       WHERE id = (SELECT application_id FROM compliance_reviews WHERE id = $1)`,
      [req.params.id]
    );
  }

  res.json({ review });
});

module.exports = router;
