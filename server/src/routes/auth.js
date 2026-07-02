import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const signupSchema = loginSchema.extend({
  phone: z.string().min(6, 'Phone number looks too short'),
});

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

// Strip the hash before anything leaves the server.
function publicUser(user) {
  return { id: user.id, email: user.email, phone: user.phone, createdAt: user.createdAt };
}

// POST /auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const { password, phone } = parsed.data;

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const [user] = await db
      .insert(users)
      .values({ email, phone: phone.trim(), passwordHash })
      .returning({ id: users.id, email: users.email, phone: users.phone, createdAt: users.createdAt });

    return res.status(201).json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      // Don't leak which field was wrong on a login attempt.
      return res.status(400).json({ error: 'Invalid input' });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const { password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email));
    // Same generic message whether the email is unknown or the password is wrong.
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    return res.json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me — proves a token is valid and returns the current user.
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [user] = await db
      .select({ id: users.id, email: users.email, phone: users.phone, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, req.user.id));

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
