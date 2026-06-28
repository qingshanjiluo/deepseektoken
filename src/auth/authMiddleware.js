const crypto = require('crypto');
const logger = require('../utils/logger');

class AuthMiddleware {
  constructor(options = {}) {
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.apiKeys = options.apiKeys || [];
    this.ipWhitelist = options.ipWhitelist || [];
    this.bearerTokens = options.bearerTokens || [];
  }

  // API Key authentication
  validateApiKey(req) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return false;
    return this.apiKeys.includes(apiKey);
  }

  // Bearer Token authentication
  validateBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7);
    return this.bearerTokens.includes(token);
  }

  // IP whitelist validation
  validateIP(req) {
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    if (this.ipWhitelist.length === 0) return true;
    // Check if IP matches any pattern in whitelist
    return this.ipWhitelist.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return regex.test(ip);
      }
      return ip === pattern;
    });
  }

  // Main authentication middleware
  authenticate(req, res, next) {
    if (!this.enabled) {
      return next();
    }

    // Check IP whitelist first
    if (!this.validateIP(req)) {
      logger.warn(`Auth failed: IP ${req.ip} not in whitelist`);
      return res.status(403).json({ error: 'Access denied: IP not allowed' });
    }

    // Check API Key
    if (this.apiKeys.length > 0 && this.validateApiKey(req)) {
      return next();
    }

    // Check Bearer Token
    if (this.bearerTokens.length > 0 && this.validateBearerToken(req)) {
      return next();
    }

    // If no auth method matches and auth is required
    logger.warn(`Auth failed for request to ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Generate a new API key
  generateApiKey() {
    return 'fds_' + crypto.randomBytes(24).toString('hex');
  }

  // Generate a new Bearer token
  generateBearerToken() {
    return 'fds_bearer_' + crypto.randomBytes(32).toString('hex');
  }

  // Add API key to whitelist
  addApiKey(key) {
    if (!this.apiKeys.includes(key)) {
      this.apiKeys.push(key);
      logger.info(`Added API key: ${key.slice(0, 10)}...`);
    }
  }

  // Remove API key
  removeApiKey(key) {
    this.apiKeys = this.apiKeys.filter(k => k !== key);
  }

  // Add IP to whitelist
  addIP(ip) {
    if (!this.ipWhitelist.includes(ip)) {
      this.ipWhitelist.push(ip);
      logger.info(`Added IP to whitelist: ${ip}`);
    }
  }

  // Remove IP from whitelist
  removeIP(ip) {
    this.ipWhitelist = this.ipWhitelist.filter(i => i !== ip);
  }

  getStats() {
    return {
      enabled: this.enabled,
      apiKeyCount: this.apiKeys.length,
      bearerTokenCount: this.bearerTokens.length,
      ipWhitelistCount: this.ipWhitelist.length,
    };
  }
}

module.exports = AuthMiddleware;