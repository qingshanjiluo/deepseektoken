const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class HotReloadConfig {
  constructor(configPath, callback) {
    this.configPath = path.resolve(configPath);
    this.callback = callback;
    this.config = null;
    this.watcher = null;
    this.load();
    this.watch();
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        this.config = data;
        if (this.callback) this.callback(this.config);
        logger.info(`Hot reload config loaded from ${this.configPath}`);
      }
    } catch (error) {
      logger.error(`Failed to load config: ${error.message}`);
    }
  }

  watch() {
    try {
      this.watcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          logger.info('Config file changed, reloading...');
          setTimeout(() => this.load(), 100);
        }
      });
    } catch (error) {
      logger.warn(`Failed to watch config: ${error.message}`);
    }
  }

  get(key) {
    if (!this.config) return null;
    return key ? this.config[key] : this.config;
  }

  close() {
    if (this.watcher) {
      this.watcher.close();
    }
  }
}

module.exports = HotReloadConfig;