const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class SessionStore {
  constructor(options = {}) {
    this.storeType = options.storeType || 'memory'; // 'memory', 'file', 'redis'
    this.sessions = new Map();
    this.filePath = options.filePath || path.join(__dirname, '../../data/sessions.json');
    this.redisClient = null;
    this.prefix = options.prefix || 'session:';
    this.ttl = options.ttl || 3600;
    this.dirty = false;
    this.saveInterval = options.saveInterval || 5000;
    
    if (this.storeType === 'file') {
      this.loadFromFile();
      this.startAutoSave();
    }
    
    if (this.storeType === 'redis') {
      // Redis support would be initialized here
      logger.info('Redis session store configured (requires redis client setup)');
    }
  }

  async get(sessionId) {
    if (this.storeType === 'redis' && this.redisClient) {
      const key = this.prefix + sessionId;
      const data = await this.redisClient.get(key);
      if (data) {
        try {
          const session = JSON.parse(data);
          if (session.expires && Date.now() > session.expires) {
            await this.redisClient.del(key);
            return null;
          }
          return session;
        } catch (e) { return null; }
      }
      return null;
    }
    
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.expires && Date.now() > session.expires) {
        this.sessions.delete(sessionId);
        this.dirty = true;
        return null;
      }
      session.lastUsed = Date.now();
      this.dirty = true;
      return session;
    }
    return null;
  }

  async set(sessionId, data, ttl) {
    const expires = ttl ? Date.now() + ttl * 1000 : Date.now() + this.ttl * 1000;
    const session = { ...data, expires, lastUsed: Date.now() };
    
    if (this.storeType === 'redis' && this.redisClient) {
      const key = this.prefix + sessionId;
      await this.redisClient.set(key, JSON.stringify(session), 'EX', ttl || this.ttl);
      return;
    }
    
    this.sessions.set(sessionId, session);
    this.dirty = true;
  }

  async delete(sessionId) {
    if (this.storeType === 'redis' && this.redisClient) {
      await this.redisClient.del(this.prefix + sessionId);
      return;
    }
    this.sessions.delete(sessionId);
    this.dirty = true;
  }

  async clear() {
    if (this.storeType === 'redis' && this.redisClient) {
      // Would need to scan and delete keys with prefix
      logger.warn('Clearing all sessions in Redis is not implemented');
      return;
    }
    this.sessions.clear();
    this.dirty = true;
    if (this.storeType === 'file') {
      await this.saveToFile();
    }
  }

  getStats() {
    return {
      total: this.sessions.size,
      storeType: this.storeType,
    };
  }

  loadFromFile() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        for (const [key, value] of Object.entries(data)) {
          if (value.expires && Date.now() > value.expires) {
            continue; // Skip expired sessions
          }
          this.sessions.set(key, value);
        }
        logger.info(`Loaded ${this.sessions.size} sessions from ${this.filePath}`);
      }
    } catch (error) {
      logger.error(`Failed to load sessions from file: ${error.message}`);
    }
  }

  async saveToFile() {
    if (!this.dirty) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.sessions);
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
      this.dirty = false;
      logger.debug(`Saved ${this.sessions.size} sessions to ${this.filePath}`);
    } catch (error) {
      logger.error(`Failed to save sessions to file: ${error.message}`);
    }
  }

  startAutoSave() {
    setInterval(() => {
      if (this.dirty) {
        this.saveToFile();
      }
    }, this.saveInterval);
  }

  // Redis support
  setRedisClient(client) {
    this.redisClient = client;
    this.storeType = 'redis';
    logger.info('Redis client connected for session store');
  }

  async close() {
    if (this.storeType === 'file' && this.dirty) {
      await this.saveToFile();
    }
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}

module.exports = SessionStore;