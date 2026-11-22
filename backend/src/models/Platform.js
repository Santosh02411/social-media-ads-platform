import { decryptJson, encryptJson, isEncrypted } from '../utils/crypto.js';

const COLUMNS = 'id, name, type, config, user_id, is_connected, created_at, updated_at';

/**
 * Platform integrations. The `config` column holds API credentials, so it is
 * stored AES-256-GCM encrypted. Callers that return data to the browser must
 * use Platform.toPublic(), which never includes credential fields.
 */
export class Platform {
  constructor(db, encryptionKey) {
    this.db = db;
    this.encryptionKey = encryptionKey;
  }

  /** Safe view for API responses: no tokens, secrets or raw config. */
  static toPublic(platform) {
    if (!platform) return platform;
    const cfg = platform.config || {};
    const hintSource = cfg.accountId || '';

    return {
      id: platform.id,
      name: platform.name,
      type: platform.type,
      user_id: platform.user_id,
      is_connected: Boolean(platform.is_connected),
      created_at: platform.created_at,
      updated_at: platform.updated_at,
      config: {
        connectedAt: cfg.connectedAt || null,
        disconnectedAt: cfg.disconnectedAt || null,
        accountHint: hintSource ? `••••${String(hintSource).slice(-4)}` : null,
        accountName: cfg.accountName || null,
        currency: cfg.currency || null,
        tokenExpiresAt: cfg.tokenExpiresAt || null,
        authMethod: cfg.authMethod || null,
      },
    };
  }

  /** Decrypts a DB row; plaintext rows from before encryption are re-saved encrypted. */
  async hydrate(row) {
    if (!row) return row;
    const config = await decryptJson(this.encryptionKey, row.config, row.id);
    if (row.config && !isEncrypted(row.config)) {
      await this.saveConfig(row.id, config);
    }
    return { ...row, config };
  }

  async saveConfig(platformId, config) {
    const encrypted = await encryptJson(this.encryptionKey, config || {}, platformId);
    await this.db
      .prepare('UPDATE platforms SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(encrypted, platformId)
      .run();
  }

  async create({ name, type }, userId) {
    const platformId = crypto.randomUUID();
    const encrypted = await encryptJson(this.encryptionKey, {}, platformId);

    await this.db
      .prepare('INSERT INTO platforms (id, name, type, config, user_id) VALUES (?, ?, ?, ?, ?)')
      .bind(platformId, name, type, encrypted, userId)
      .run();

    return this.findById(platformId);
  }

  async findById(platformId) {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM platforms WHERE id = ?`)
      .bind(platformId)
      .first();
    return this.hydrate(row);
  }

  async #list(sql, ...params) {
    const { results } = await this.db.prepare(sql).bind(...params).all();
    return Promise.all((results || []).map((row) => this.hydrate(row)));
  }

  findByUserId(userId) {
    return this.#list(
      `SELECT ${COLUMNS} FROM platforms WHERE user_id = ? ORDER BY created_at DESC`,
      userId
    );
  }

  getConnectedPlatforms(userId) {
    return this.#list(
      `SELECT ${COLUMNS} FROM platforms WHERE user_id = ? AND is_connected = 1 ORDER BY created_at DESC`,
      userId
    );
  }

  getByType(type, userId) {
    return this.#list(
      `SELECT ${COLUMNS} FROM platforms WHERE type = ? AND user_id = ? ORDER BY created_at DESC`,
      type,
      userId
    );
  }

  /** Renames a platform. Credentials and connection state are NOT touched here. */
  async rename(platformId, name) {
    await this.db
      .prepare('UPDATE platforms SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(name, platformId)
      .run();
    return this.findById(platformId);
  }

  async delete(platformId) {
    await this.db.prepare('DELETE FROM platforms WHERE id = ?').bind(platformId).run();
  }

  /** Stores validated credentials (encrypted) and marks the platform connected. */
  async connect(platformId, credentials, info = {}) {
    const platform = await this.findById(platformId);
    if (!platform) throw new Error('Platform not found');

    const config = {
      ...platform.config,
      ...credentials,
      accountName: info.accountName ?? credentials.accountName ?? null,
      currency: info.currency ?? credentials.currency ?? platform.config.currency ?? null,
      connectedAt: new Date().toISOString(),
    };
    delete config.disconnectedAt;

    await this.saveConfig(platformId, config);
    await this.db
      .prepare('UPDATE platforms SET is_connected = 1 WHERE id = ?')
      .bind(platformId)
      .run();

    return this.findById(platformId);
  }

  /** Marks the platform disconnected AND wipes the stored credentials. */
  async disconnect(platformId) {
    const platform = await this.findById(platformId);
    if (!platform) throw new Error('Platform not found');

    await this.saveConfig(platformId, { disconnectedAt: new Date().toISOString() });
    await this.db
      .prepare('UPDATE platforms SET is_connected = 0 WHERE id = ?')
      .bind(platformId)
      .run();

    return this.findById(platformId);
  }
}
