const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class AccountManager {
  constructor(config) {
    this.config = config;
    this.accounts = [];
    this.currentIndex = 0;
    this.watchers = [];
    this.loadAccounts();
    this.setupWatcher();
  }

  loadAccounts() {
    try {
      const authPath = path.resolve(this.config.auth.path);
      if (fs.existsSync(authPath)) {
        const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        this.accounts = Array.isArray(data) ? data : [data];
        this.accounts = this.accounts.map(acc => ({ ...acc, cooldownUntil: 0, enabled: true }));
        logger.info(`Loaded ${this.accounts.length} accounts from ${authPath}`);
        this.notifyWatchers();
      }
    } catch (error) {
      logger.error(`Failed to load accounts: ${error.message}`);
    }
  }

  setupWatcher() {
    const authPath = path.resolve(this.config.auth.path);
    if (!fs.existsSync(authPath)) return;

    try {
      fs.watch(authPath, (eventType) => {
        if (eventType === 'change') {
          logger.info('Account file changed, reloading...');
          setTimeout(() => this.loadAccounts(), 500);
        }
      });
    } catch (error) {
      logger.warn(`File watcher error: ${error.message}`);
    }
  }

  getNextAccount() {
    const now = Date.now();
    const available = this.accounts.filter(a => a.enabled && a.cooldownUntil <= now);
    
    if (available.length === 0) {
      // All accounts in cooldown or disabled
      const sorted = [...this.accounts].filter(a => a.enabled).sort((a, b) => a.cooldownUntil - b.cooldownUntil);
      if (sorted.length > 0) {
        const account = sorted[0];
        this.currentIndex = this.accounts.indexOf(account);
        return account;
      }
      return null;
    }

    // Find next available from current index
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.currentIndex + i) % this.accounts.length;
      const account = this.accounts[idx];
      if (account.enabled && account.cooldownUntil <= now) {
        this.currentIndex = (idx + 1) % this.accounts.length;
        return account;
      }
    }
    return null;
  }

  addAccount(account) {
    this.accounts.push({ ...account, cooldownUntil: 0, enabled: true });
    this.saveAccounts();
    return this.accounts.length - 1;
  }

  removeAccount(index) {
    if (index >= 0 && index < this.accounts.length) {
      this.accounts.splice(index, 1);
      this.saveAccounts();
      return true;
    }
    return false;
  }

  toggleAccount(index, enabled) {
    if (index >= 0 && index < this.accounts.length) {
      this.accounts[index].enabled = enabled;
      this.saveAccounts();
      return true;
    }
    return false;
  }

  markCooldown(account, durationMs) {
    const found = this.accounts.find(a => a.token === account.token);
    if (found) {
      found.cooldownUntil = Date.now() + durationMs;
      logger.warn(`Account ${account.token?.slice(0, 10)}... marked cooldown until ${new Date(found.cooldownUntil).toISOString()}`);
    }
  }

  getAvailableCount() {
    const now = Date.now();
    return this.accounts.filter(a => a.enabled && a.cooldownUntil <= now).length;
  }

  getAllAccounts() {
    return this.accounts;
  }

  getStats() {
    const now = Date.now();
    const total = this.accounts.length;
    const enabled = this.accounts.filter(a => a.enabled).length;
    const available = this.accounts.filter(a => a.enabled && a.cooldownUntil <= now).length;
    const inCooldown = this.accounts.filter(a => a.enabled && a.cooldownUntil > now).length;
    return { total, enabled, available, inCooldown };
  }

  saveAccounts() {
    try {
      const authPath = path.resolve(this.config.auth.path);
      const data = this.accounts.map(({ cooldownUntil, enabled, ...rest }) => rest);
      fs.writeFileSync(authPath, JSON.stringify(data, null, 2));
      logger.info(`Saved ${data.length} accounts to ${authPath}`);
    } catch (error) {
      logger.error(`Failed to save accounts: ${error.message}`);
    }
  }

  watch(callback) {
    this.watchers.push(callback);
  }

  notifyWatchers() {
    for (const callback of this.watchers) {
      try { callback(this.accounts); } catch (e) {}
    }
  }
}

module.exports = AccountManager;