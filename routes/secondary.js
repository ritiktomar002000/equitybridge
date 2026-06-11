// routes/secondary.js — Secondary Marketplace
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAuth, requireKYC } = require('../middleware/auth');

const router = express.Router();

// GET /api/secondary — browse all active resale listings
router.get('/', async (req, res) => {
  const { category, min_price, max_price, limit = 20, offset = 0 } = req.query;
  let sql = `
    SELECT sl.*, 
      b.name as business_name, b.category, b.location_city, b.location_state, b.logo_url,
      u.first_name || ' ' || u.last_name as seller_name,
      ROUND(((sl.asking_price - sl.original_cost) / sl.original_cost) * 100, 1) as return_pct
    FROM secondary_listings sl
    JOIN businesses b ON sl.business_id = b.id
    JOIN users u ON sl.seller_id = u.id
    WHERE sl.status = 'active' AND sl.expires_at > NOW()`;
  const params = [];
  if (category)  { params.push(category);   sql += ` AND b.category = $${params.length}`; }
  if (min_price) { params.push(min_price);  sql += ` AND sl.asking_price >= $${params.length}`; }
  if (max_price) { params.push(max_price);  sql += ` AND sl.asking_price <= $${params.length}`; }
  params.push(Number(limit), Number(offset));
  sql += ` ORDER BY sl.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
  const { data, error } = await db.query(sql, params);
  if (error) return res.status(500).json({ error });
  res.json({ listings: data });
});

// POST /api/secondary — list your stake for sale
router.post('/', requireAuth, requireKYC, async (req, res) => {
  const { investment_id, asking_price } = req.body;
  if (!investment_id || !asking_price) return res.status(400).json({ error: 'investment_id and asking_price required.' });

  // Verify ownership
  const { data: inv } = await db.select('investments', { where: { id: investment_id }, single: true });
  if (!inv || inv.investor_id !== req.user.id) return res.status(403).json({ error: 'Investment not found.' });
  if (inv.status !== 'completed') return res.status(400).json({ error: 'Only completed investments can be listed.' });

  // Check not already listed
  const { data: existing } = await db.query(
    `SELECT id FROM secondary_listings WHERE investment_id = $1 AND status = 'active'`,
    [investment_id]
  );
  if (existing?.length) return res.status(400).json({ error: 'This investment is already listed.' });

  const { data, error } = await db.insert('secondary_listings', {
    id: uuidv4(), investment_id, seller_id: req.user.id,
    business_id: inv.business_id, offering_id: inv.offering_id,
    equity_share: inv.equity_share, asking_price, original_cost: inv.amount,
    status: 'active', expires_at: new Date(Date.now() + 90 * 24 * 3600000),
    created_at: new Date(), updated_at: new Date(),
  }, { returning: '*' });
  if (error) return res.status(500).json({ error });

  res.status(201).json({ listing: data, message: 'Your stake is now listed for sale.' });
});

// POST /api/secondary/:id/buy — purchase a listed stake
router.post('/:id/buy', requireAuth, requireKYC, async (req, res) => {
  const { data: listing } = await db.select('secondary_listings', { where: { id: req.params.id }, single: true });
  if (!listing || listing.status !== 'active') return res.status(404).json({ error: 'Listing not found or no longer available.' });
  if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot buy your own listing.' });

  const paymentProcessor = require('../lib/payment-processor');
  const { data: intent } = await paymentProcessor.createPaymentIntent({
    userId: req.user.id, amount: Math.round(listing.asking_price * 100),
    description: `Secondary purchase: ${listing.equity_share}% equity`,
    metadata: { secondary_listing_id: listing.id },
  });

  // Transfer ownership in DB
  await db.transaction(async () => {
    // Mark old investment cancelled
    await db.update('investments', { status: 'cancelled', updated_at: new Date() }, { id: listing.investment_id });
    // Create new investment for buyer
    await db.insert('investments', {
      id: uuidv4(), offering_id: listing.offering_id, investor_id: req.user.id,
      business_id: listing.business_id, amount: listing.asking_price,
      equity_share: listing.equity_share, status: 'completed', created_at: new Date(), updated_at: new Date(),
    }, { returning: 'id' });
    // Close listing
    await db.update('secondary_listings',
      { status: 'sold', buyer_id: req.user.id, sold_price: listing.asking_price, sold_at: new Date(), updated_at: new Date() },
      { id: listing.id }
    );
  });

  await notifyUser(listing.seller_id, 'secondary_sold',
    'Your stake was purchased!',
    `Your ${listing.equity_share}% stake sold for $${listing.asking_price}.`
  );

  res.json({ message: 'Purchase successful!', equity_share: listing.equity_share, amount_paid: listing.asking_price });
});

// DELETE /api/secondary/:id — cancel your listing
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: listing } = await db.select('secondary_listings', { where: { id: req.params.id }, single: true });
  if (!listing || listing.seller_id !== req.user.id) return res.status(403).json({ error: 'Not found.' });
  await db.update('secondary_listings', { status: 'cancelled', updated_at: new Date() }, { id: req.params.id });
  res.json({ message: 'Listing cancelled.' });
});

async function notifyUser(userId, type, title, message, data = {}) {
  await db.insert('notifications', {
    id: uuidv4(), user_id: userId, type, title, message,
    data: JSON.stringify(data), created_at: new Date(),
  }, { returning: 'id' }).catch(() => {});
}

module.exports = router;
