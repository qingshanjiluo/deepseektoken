const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class AccountPool {
  constructor(config) {
    this.accounts = [];
    this.currentIndex = 0;
    this.config = config;
    this.loadAccounts();
  }

  loadAccounts() {
    try {
      const authPath = path.resolve(this.config.auth.path);
      if (fs.existsSync(authPath)) {
        const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        if (Array.isArray(data)) {
          this.accounts = data.map(acc => ({ ...acc, cooldownUntil: 0 }));
        } else {
          this.accounts = [{ ...data, cooldownUntil: 0 }];
        }
        logger.info(`Loaded ${this.accounts.length} accounts from ${authPath}`);
      } else if (this.config.auth.dir) {
        const dir = path.resolve(this.config.auth.dir);
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
          for (const file of files) {
            const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            this.accounts.push({ ...data, cooldownUntil: 0 });
          }
          logger.info(`Loaded ${this.accounts.length} accounts from ${dir}`);
        }
      }
    } catch (error) {
      logger.error(`Failed to load accounts: ${error.message}`);
    }
  }

  getNextAccount() {
    const now = Date.now();
    for (let i = 0; i < this.accounts.length; i++) {
      const idx = (this.currentIndex + i) % this.accounts.length;
      const account = this.accounts[idx];
      if (account.cooldownUntil <= now) {
        this.currentIndex = (idx + 1) % this.accounts.length;
        return account;
      }
    }
    // All accounts are in cooldown, find the one with earliest cooldown
    let minCooldown = Infinity;
    let minIdx = 0;
    for (let i = 0; i < this.accounts.length; i++) {
      if (this.accounts[i].cooldownUntil < minCooldown) {
        minCooldown = this.accounts[i].cooldownUntil;
        minIdx = i;
      }
    }
    this.currentIndex = (minIdx + 1) % this.accounts.length;
    return this.accounts[minIdx];
  }

  markCooldown(account, durationMs) {
    account.cooldownUntil = Date.now() + durationMs;
    logger.warn(`Account ${account.token?.slice(0, 10)}... marked cooldown until ${new Date(account.cooldownUntil).toISOString()}`);
  }

  getAvailableCount() {
    const now = Date.now();
    return this.accounts.filter(a => a.cooldownUntil <= now).length;
  }

  getAllAccounts() {
    return this.accounts;
  }
}

module.exports = AccountPool;
