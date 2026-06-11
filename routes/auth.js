// routes/auth.js
const express = require('express');
const authLib = require('../lib/auth');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, role, phone } = req.body;

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!['investor', 'owner'].includes(role)) return res.status(400).json({ error: 'Role must be investor or owner.' });

  const { data, error } = await authLib.createUser(email, password, { firstName, lastName, role, phone });
  if (error) return res.status(400).json({ error });

  res.status(201).json({
    message: 'Account created successfully.',
    user:          data.user,
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await authLib.authenticateUser(email, password);
  if (error) return res.status(401).json({ error });

  res.json({
    user:          data.user,
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/me
router.put('/me', requireAuth, async (req, res) => {
  const allowed = ['first_name','last_name','phone','date_of_birth',
                   'address_line1','address_city','address_state','address_zip'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  updates.updated_at = new Date();

  const db = require('../lib/db');
  const { data, error } = await db.update('users', updates, { id: req.user.id }, { returning: 'id,email,first_name,last_name,role,phone,kyc_status' });
  if (error) return res.status(400).json({ error });
  res.json({ user: data });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'Refresh token required.' });

  const { data, error } = await authLib.refreshAccessToken(refresh_token);
  if (error) return res.status(401).json({ error });
  res.json(data);
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required.' });
  if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const { error } = await authLib.changePassword(req.user.id, current_password, new_password);
  if (error) return res.status(400).json({ error });
  res.json({ message: 'Password changed successfully.' });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  await authLib.createPasswordResetToken(email);
  // Always 200 — prevent email enumeration
  res.json({ message: 'If that email exists, a reset link has been sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || !new_password) return res.status(400).json({ error: 'Token and new password required.' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const { error } = await authLib.resetPassword(token, new_password);
  if (error) return res.status(400).json({ error });
  res.json({ message: 'Password reset successfully. You can now log in.' });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, (_req, res) => {
  res.json({ message: 'Logged out successfully.' });
});

module.exports = router;
