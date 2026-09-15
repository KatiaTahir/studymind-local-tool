const jwt = require('jsonwebtoken');

// checks the Authorization header and pulls the user id out of the jwt
// so route handlers can just use req.userId
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!rawToken) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  try {
    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET || 'dev_secret');
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
