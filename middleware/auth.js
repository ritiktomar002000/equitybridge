// middleware/auth.js
const authLib = require('../lib/auth');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing.' });
  }
  const token = header.slice(7);
  const { payload, error } = authLib.verifyAccessToken(token);
  if (error || !payload) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  const { data: user, error: userErr } = await authLib.getUserById(payload.sub);
  if (userErr || !user) return res.status(401).json({ error: 'User not found.' });
  if (user.is_suspended) return res.status(403).json({ error: 'Account suspended.' });

  req.user  = user;
  req.token = token;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}.` });
    }
    next();
  };
}

function requireKYC(req, res, next) {
  if (req.user?.kyc_status !== 'approved') {
    return res.status(403).json({
      error: 'Identity verification (KYC) required before investing.',
      kyc_status: req.user?.kyc_status,
      action: 'Please complete KYC at /api/compliance/kyc'
    });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireKYC };
