const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class ProxyKeyStore {
  constructor(options = {}) {
    this.filePath = path.resolve(
      options.filePath || process.env.PROXY_AUTH_PATH || './proxy-auth.json',
    );
    this.config = {
      enabled: false,
      apiKeys: [],
      bearerTokens: [],
      ipWhitelist: [],
    };
  }

  async load() {
    if (!fs.existsSync(this.filePath)) {
      return this.config;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw);
    this.config = {
      enabled: parsed.enabled === true,
      apiKeys: Array.isArray(parsed.apiKeys) ? [...parsed.apiKeys] : [],
      bearerTokens: Array.isArray(parsed.bearerTokens)
        ? [...parsed.bearerTokens]
        : [],
      ipWhitelist: Array.isArray(parsed.ipWhitelist)
        ? [...parsed.ipWhitelist]
        : [],
    };
    return this.config;
  }

  async save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2));
  }

  getConfig() {
    return {
      enabled: this.config.enabled,
      apiKeys: [...this.config.apiKeys],
      bearerTokens: [...this.config.bearerTokens],
      ipWhitelist: [...this.config.ipWhitelist],
    };
  }

  setEnabled(enabled) {
    this.config.enabled = enabled === true;
  }

  generateApiKey() {
    return 'fds_' + crypto.randomBytes(24).toString('hex');
  }

  generateBearerToken() {
    return 'fds_bearer_' + crypto.randomBytes(32).toString('hex');
  }

  addApiKey(apiKey) {
    if (apiKey && !this.config.apiKeys.includes(apiKey)) {
      this.config.apiKeys.push(apiKey);
    }
  }

  addBearerToken(token) {
    if (token && !this.config.bearerTokens.includes(token)) {
      this.config.bearerTokens.push(token);
    }
  }

  removeApiKey(apiKey) {
    this.config.apiKeys = this.config.apiKeys.filter((key) => key !== apiKey);
  }

  removeBearerToken(token) {
    this.config.bearerTokens = this.config.bearerTokens.filter(
      (item) => item !== token,
    );
  }
}

module.exports = { ProxyKeyStore };
