class RateLimiter {
  constructor(options = {}) {
    this.limits = options.limits || {
      'deepseek-chat': { requestsPerMinute: 60 },
      'deepseek-reasoner': { requestsPerMinute: 30 },
      'default': { requestsPerMinute: 20 },
    };
    this.tokens = new Map();
    this.lastRefill = new Map();
    this.defaultLimit = this.limits.default || { requestsPerMinute: 20 };
  }

  getLimit(model) {
    return this.limits[model] || this.defaultLimit;
  }

  canMakeRequest(model, accountId) {
    const key = `${accountId}:${model}`;
    const limit = this.getLimit(model);
    const now = Date.now();
    const refillInterval = 60000 / limit.requestsPerMinute;

    if (!this.tokens.has(key)) {
      this.tokens.set(key, Math.max(0, limit.requestsPerMinute - 1));
      this.lastRefill.set(key, now);
      return true;
    }

    // Refill tokens based on time elapsed
    const lastRefillTime = this.lastRefill.get(key) || now;
    const elapsed = now - lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / refillInterval);
    
    if (tokensToAdd > 0) {
      let currentTokens = this.tokens.get(key) || 0;
      currentTokens = Math.min(limit.requestsPerMinute, currentTokens + tokensToAdd);
      this.tokens.set(key, currentTokens);
      this.lastRefill.set(key, now);
    }

    const available = this.tokens.get(key) || 0;
    if (available > 0) {
      this.tokens.set(key, available - 1);
      return true;
    }
    return false;
  }

  getWaitTime(model, accountId) {
    const key = `${accountId}:${model}`;
    const limit = this.getLimit(model);
    const now = Date.now();
    const refillInterval = 60000 / limit.requestsPerMinute;
    const lastRefillTime = this.lastRefill.get(key) || now;
    const elapsed = now - lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / refillInterval);
    const currentTokens = Math.min(limit.requestsPerMinute, (this.tokens.get(key) || 0) + tokensToAdd);
    
    if (currentTokens > 0) return 0;
    return Math.ceil(refillInterval - (elapsed % refillInterval));
  }

  getStats(model, accountId) {
    const key = `${accountId}:${model}`;
    const limit = this.getLimit(model);
    const now = Date.now();
    const refillInterval = 60000 / limit.requestsPerMinute;
    const lastRefillTime = this.lastRefill.get(key) || now;
    const elapsed = now - lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / refillInterval);
    const currentTokens = Math.min(limit.requestsPerMinute, (this.tokens.get(key) || 0) + tokensToAdd);
    
    return {
      model,
      limit: limit.requestsPerMinute,
      available: currentTokens,
      resetIn: this.getWaitTime(model, accountId),
    };
  }
}

module.exports = RateLimiter;
