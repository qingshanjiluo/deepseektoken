const fetch = require('node-fetch');
const logger = require('../utils/logger');

class DeepSeekClient {
  constructor(account, options = {}) {
    this.account = account;
    this.baseUrl = options.baseUrl || 'https://chat.deepseek.com';
    this.timeout = options.timeout || 30000;
  }

  async chat(messages, model = 'deepseek-chat', stream = false) {
    const url = `${this.baseUrl}/api/chat/completions`;
    const payload = {
      model,
      messages,
      stream,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.account.token}`,
          'Cookie': this.account.cookie || '',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`DeepSeek API error: ${response.status} - ${errorText}`);
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      if (stream) {
        return response.body;
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  async chatStream(messages, model = 'deepseek-chat') {
    return this.chat(messages, model, true);
  }
}

module.exports = DeepSeekClient;
