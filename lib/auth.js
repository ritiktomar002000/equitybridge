// lib/auth.js — Custom JWT Authentication
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db      = require('./db');

const JWT_SECRET         = process.env.JWT_SECRET         || 'change-me-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-refresh-in-production';
const JWT_EXPIRES_IN     = process.env.JWT_EXPIRES_IN     || '7d';
const SALT_ROUNDS        = 10;

// ── TOKEN GENERATION ──────────────────────────────────────────────
function generateAccessToken(userId, role) {
  return jwt.sign({ sub: userId, role, type: 'access' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function generateRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

function verifyAccessToken(token) {
  try {
    return { payload: jwt.verify(token, JWT_SECRET), error: null };
  } catch (err) {
    return { payload: null, error: err.message };
  }
}

function verifyRefreshToken(token) {
  try {
    return { payload: jwt.verify(token, JWT_REFRESH_SECRET), error: null };
  } catch (err) {
    return { payload: null, error: err.message };
  }
}

// ── REGISTER ──────────────────────────────────────────────────────
async function createUser(email, password, profile = {}) {
  // Check if email taken
  const existing = await db.select('users', { where: { email }, single: true });
  if (existing.data) return { data: null, error: 'An account with this email already exists.' };

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const userId       = uuidv4();

  const result = await db.insert('users', {
    id:            userId,
    email:         email.toLowerCase().trim(),
    password_hash: passwordHash,
    first_name:    profile.firstName || profile.first_name || '',
    last_name:     profile.lastName  || profile.last_name  || '',
    role:          profile.role      || 'investor',
    phone:         profile.phone     || null,
    kyc_status:    'pending',
    is_accredited: false,
    created_at:    new Date(),
    updated_at:    new Date(),
  }, { returning: 'id, email, first_name, last_name, role, kyc_status, created_at' });

  if (result.error) return { data: null, error: result.error };

  const accessToken  = generateAccessToken(userId, profile.role || 'investor');
  const refreshToken = generateRefreshToken(userId);

  return {
    data: {
      user:          result.data,
      access_token:  accessToken,
      refresh_token: refreshToken,
    },
    error: null,
  };
}

// ── LOGIN ─────────────────────────────────────────────────────────
async function authenticateUser(email, password) {
  const result = await db.select('users', {
    where: { email: email.toLowerCase().trim() },
    single: true,
  });

  if (!result.data) return { data: null, error: 'Invalid email or password.' };

  const user = result.data;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return { data: null, error: 'Invalid email or password.' };

  if (user.is_suspended) return { data: null, error: 'This account has been suspended. Contact support.' };

  // Update last_login
  await db.update('users', { last_login: new Date() }, { id: user.id });

  const accessToken  = generateAccessToken(user.id, user.role);
  const refreshToken = generateRefreshToken(user.id);

  // Return user without password hash
  const { password_hash, ...safeUser } = user;

  return {
    data: {
      user:          safeUser,
      access_token:  accessToken,
      refresh_token: refreshToken,
    },
    error: null,
  };
}

// ── GET USER BY ID ────────────────────────────────────────────────
async function getUserById(userId) {
  const result = await db.query(
    `SELECT id, email, first_name, last_name, role, phone, kyc_status,
            is_accredited, annual_income, net_worth, created_at, last_login,
            address_line1, address_city, address_state, address_zip,
            date_of_birth, is_suspended
     FROM users WHERE id = $1`,
    [userId]
  );
  if (result.error || !result.data.length) return { data: null, error: 'User not found.' };
  return { data: result.data[0], error: null };
}

// ── CHANGE PASSWORD ───────────────────────────────────────────────
async function changePassword(userId, currentPassword, newPassword) {
  const { data: user } = await db.select('users', { where: { id: userId }, single: true });
  if (!user) return { error: 'User not found.' };

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return { error: 'Current password is incorrect.' };

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.update('users', { password_hash: newHash, updated_at: new Date() }, { id: userId });
  return { error: null };
}

// ── PASSWORD RESET ────────────────────────────────────────────────
async function createPasswordResetToken(email) {
  const { data: user } = await db.select('users', {
    where: { email: email.toLowerCase() }, single: true
  });
  if (!user) return { error: null }; // silent — prevent email enumeration

  const token   = uuidv4();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.deleteFrom('password_reset_tokens', { user_id: user.id });
  await db.insert('password_reset_tokens', {
    id: uuidv4(), user_id: user.id, token, expires_at: expires, created_at: new Date()
  });

  return { data: { token, email: user.email, name: user.first_name }, error: null };
}

async function resetPassword(token, newPassword) {
  const { data: rows } = await db.query(
    `SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );
  if (!rows?.length) return { error: 'Invalid or expired reset token.' };

  const resetRecord = rows[0];
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.update('users', { password_hash: newHash, updated_at: new Date() }, { id: resetRecord.user_id });
  await db.deleteFrom('password_reset_tokens', { id: resetRecord.id });

  return { error: null };
}

// ── REFRESH ACCESS TOKEN ──────────────────────────────────────────
async function refreshAccessToken(refreshToken) {
  const { payload, error } = verifyRefreshToken(refreshToken);
  if (error) return { data: null, error: 'Invalid or expired refresh token.' };

  const { data: user } = await getUserById(payload.sub);
  if (!user) return { data: null, error: 'User not found.' };

  return {
    data: { access_token: generateAccessToken(user.id, user.role) },
    error: null,
  };
}

// ── HASH PASSWORD (utility) ───────────────────────────────────────
async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

module.exports = {
  createUser,
  authenticateUser,
  getUserById,
  changePassword,
  createPasswordResetToken,
  resetPassword,
  refreshAccessToken,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashPassword,
};
