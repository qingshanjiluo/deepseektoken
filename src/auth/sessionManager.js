const crypto = require('crypto');

class SessionManager {
  constructor(options = {}) {
    this.sessions = new Map();
    this.maxSessions = options.maxSessions || 1000;
    this.defaultTTL = options.defaultTTL || 3600000; // 1 hour
    this.reuseEnabled = options.reuseEnabled !== undefined ? options.reuseEnabled : true;
  }

  createSession(account, metadata = {}) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    const session = {
      id: sessionId,
      account: { ...account },
      createdAt: Date.now(),
      lastUsed: Date.now(),
      ttl: this.defaultTTL,
      metadata,
    };
    this.sessions.set(sessionId, session);
    this.cleanup();
    return session;
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() - session.lastUsed > session.ttl) {
      this.sessions.delete(sessionId);
      return null;
    }
    session.lastUsed = Date.now();
    return session;
  }

  getSessionByAccount(account) {
    for (const [id, session] of this.sessions) {
      if (session.account.token === account.token) {
        return session;
      }
    }
    return null;
  }

  deleteSession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  setReuseEnabled(enabled) {
    this.reuseEnabled = enabled;
  }

  isReuseEnabled() {
    return this.reuseEnabled;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsed > session.ttl) {
        this.sessions.delete(id);
      }
    }
    // Limit sessions
    if (this.sessions.size > this.maxSessions) {
      const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const toRemove = sorted.slice(0, this.sessions.size - this.maxSessions);
      for (const [id] of toRemove) {
        this.sessions.delete(id);
      }
    }
  }

  getStats() {
    return {
      totalSessions: this.sessions.size,
      reuseEnabled: this.reuseEnabled,
      maxSessions: this.maxSessions,
    };
  }
}

module.exports = SessionManager;
