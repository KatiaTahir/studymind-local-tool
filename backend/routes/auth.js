const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// not a full email validator, just enough to catch obvious junk before it hits the database
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// bcrypt truncates anything past 72 bytes, so two long passwords sharing the same
// first 72 bytes would count as identical. capping the input avoids that
const MAX_PW_LENGTH = 72;

function createAuthRouter(pool) {
  const router = express.Router();
  const saltRounds = 10;

  router.post('/signup', async (req, res) => {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    email = String(email).trim().toLowerCase();
    if (email.length > 255 || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    if (password.length > MAX_PW_LENGTH) {
      return res.status(400).json({ error: `password must be at most ${MAX_PW_LENGTH} characters` });
    }

    try {
      const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
      if (existingUsers.length > 0) {
        return res.status(409).json({ error: 'An account with that email already exists' });
      }

      const pwHash = await bcrypt.hash(password, saltRounds);
      const [result] = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)',
        [email, pwHash]
      );

      const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET || 'dev_secret', {
        expiresIn: '7d',
      });
      return res.status(201).json({ token, user: { id: result.insertId, email } });
    } catch (err) {
      return res.status(500).json({ error: 'Signup failed', details: err.message });
    }
  });

  router.post('/login', async (req, res) => {
    let { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    email = String(email).trim().toLowerCase();

    try {
      const [matchingUsers] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (matchingUsers.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = matchingUsers[0];
      const passwordOk = await bcrypt.compare(password, user.password_hash);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'dev_secret', {
        expiresIn: '7d',
      });
      return res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
      return res.status(500).json({ error: 'Login failed', details: err.message });
    }
  });

  return router;
}

module.exports = { createAuthRouter };
