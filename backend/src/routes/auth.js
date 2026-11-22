import { Hono } from 'hono';
import { User, DUMMY_HASH } from '../models/User.js';
import { Log } from '../models/Log.js';
import bcrypt from 'bcryptjs';
import { authMiddleware } from '../middleware/auth.js';
import { validateJson } from '../middleware/validate.js';
import {
  rateLimit,
  isLoginLocked,
  recordFailedLogin,
  clearFailedLogins,
  LOGIN_LOCK_SECONDS,
} from '../middleware/rateLimit.js';
import {
  createSession,
  readSession,
  destroySession,
  clearSessionCookie,
} from '../utils/session.js';
import { loginSchema, registerSchema } from '../validation/schemas.js';

const auth = new Hono();

// Register: no session is created; the user signs in afterwards.
auth.post(
  '/register',
  rateLimit({ name: 'register', limit: 5, windowSeconds: 60 * 60 }),
  validateJson(registerSchema),
  async (c) => {
    const { email, password, name } = c.get('body');
    const users = new User(c.env.DB);

    if (await users.findByEmail(email)) {
      return c.json({ error: 'Email already exists' }, 409);
    }

    let newUser;
    try {
      newUser = await users.create({ email, password, name });
    } catch (error) {
      // Lost a race with a concurrent registration of the same email
      if (error.message === 'Email already exists') {
        return c.json({ error: 'Email already exists' }, 409);
      }
      throw error;
    }

    await new Log(c.env.DB).info('User registered', { userId: newUser.id }, newUser.id);

    return c.json({ user: { id: newUser.id, email: newUser.email, name: newUser.name } }, 201);
  }
);

// Login: sets an httpOnly session cookie. The token is never put in the response body.
auth.post(
  '/login',
  rateLimit({ name: 'login', limit: 20, windowSeconds: 15 * 60 }),
  validateJson(loginSchema),
  async (c) => {
    const { email, password } = c.get('body');

    if (await isLoginLocked(c.env, email)) {
      c.header('Retry-After', String(LOGIN_LOCK_SECONDS));
      return c.json({ error: 'Too many failed attempts. Please try again later.' }, 429);
    }

    const users = new User(c.env.DB);
    const foundUser = await users.findByEmail(email);

    // Same work and same message whether or not the account exists
    let valid = false;
    if (foundUser) {
      valid = await users.verifyPassword(foundUser, password);
    } else {
      await bcrypt.compare(password, DUMMY_HASH);
    }

    if (!valid) {
      await recordFailedLogin(c.env, email);
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    await clearFailedLogins(c.env, email);
    await createSession(c, foundUser);
    await new Log(c.env.DB).info('User logged in', { userId: foundUser.id }, foundUser.id);

    return c.json({ user: { id: foundUser.id, email: foundUser.email, name: foundUser.name } });
  }
);

// Logout: always clears the cookie; revokes the server-side session if there is one.
auth.post('/logout', async (c) => {
  const session = await readSession(c);
  if (session) {
    await destroySession(c.env, session.sessionId);
    await new Log(c.env.DB).info('User logged out', { userId: session.userId }, session.userId);
  }
  clearSessionCookie(c);
  return c.json({ message: 'Logged out successfully' });
});

// Current user (used by the frontend to find out whether it is signed in)
auth.get('/me', authMiddleware, async (c) => {
  const user = await new User(c.env.DB).findById(c.get('userId'));
  if (!user) {
    await destroySession(c.env, c.get('sessionId'));
    clearSessionCookie(c);
    return c.json({ error: 'Authentication required' }, 401);
  }
  return c.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// Rotate the session: new id + fresh expiry, old one revoked.
auth.post('/refresh', authMiddleware, async (c) => {
  const user = await new User(c.env.DB).findById(c.get('userId'));
  if (!user) return c.json({ error: 'Authentication required' }, 401);

  await destroySession(c.env, c.get('sessionId'));
  await createSession(c, user);
  return c.json({ message: 'Session refreshed' });
});

export { auth as authRoutes };
