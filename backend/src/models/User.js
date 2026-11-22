import bcrypt from 'bcryptjs';

// Work factor for new password hashes. Existing hashes made with a lower
// cost are transparently upgraded the next time that user logs in.
export const BCRYPT_COST = 12;

// Valid bcrypt hash of a random string. Compared against when the email is
// unknown so "no such user" and "wrong password" take the same time.
export const DUMMY_HASH = '$2a$12$CNGOpELVL5ErRHCllafnfuacz1jl9pBy4afgYtDnptNLUkEktVvXG';

export class User {
  constructor(db) {
    this.db = db;
  }

  async create({ email, password, name }) {
    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    try {
      await this.db
        .prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
        .bind(userId, email, passwordHash, name || null)
        .run();
      return { id: userId, email, name: name || null };
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) {
        throw new Error('Email already exists');
      }
      throw error;
    }
  }

  // Case-insensitive so accounts created before emails were normalised still match.
  async findByEmail(email) {
    return this.db
      .prepare(
        `SELECT id, email, password_hash, name, created_at, updated_at
         FROM users WHERE lower(email) = lower(?)`
      )
      .bind(email)
      .first();
  }

  async findById(userId) {
    return this.db
      .prepare('SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?')
      .bind(userId)
      .first();
  }

  /** Verifies a password; upgrades the stored hash if it uses an older cost. */
  async verifyPassword(user, password) {
    const valid = await bcrypt.compare(password, user.password_hash);

    if (valid && bcrypt.getRounds(user.password_hash) < BCRYPT_COST) {
      const upgraded = await bcrypt.hash(password, BCRYPT_COST);
      await this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(upgraded, user.id)
        .run();
    }

    return valid;
  }

  async update(userId, { name }) {
    await this.db
      .prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(name ?? null, userId)
      .run();
    return this.findById(userId);
  }

  async delete(userId) {
    await this.db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  }
}
