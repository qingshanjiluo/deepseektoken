const cluster = require('cluster');
const os = require('os');
const logger = require('../utils/logger');

class ClusterManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== undefined ? options.enabled : true;
    this.workers = options.workers || os.cpus().length;
    this.serverPath = options.serverPath || './index.js';
  }

  start() {
    if (!this.enabled) {
      logger.info('Cluster mode disabled, starting single instance');
      return this.startWorker();
    }

    if (cluster.isMaster) {
      logger.info(`Master process starting (PID: ${process.pid})`);
      logger.info(`Starting ${this.workers} worker instances`);

      for (let i = 0; i < this.workers; i++) {
        cluster.fork();
      }

      cluster.on('exit', (worker, code, signal) => {
        logger.warn(`Worker ${worker.process.pid} died (${signal || code})`);
        if (this.enabled) {
          logger.info('Starting new worker...');
          cluster.fork();
        }
      });

      cluster.on('online', (worker) => {
        logger.info(`Worker ${worker.process.pid} is online`);
      });

      // Graceful shutdown
      process.on('SIGINT', () => {
        logger.info('Shutting down cluster...');
        for (const id in cluster.workers) {
          cluster.workers[id].kill();
        }
        process.exit(0);
      });
    } else {
      this.startWorker();
    }
  }

  startWorker() {
    require(this.serverPath);
  }

  getStats() {
    if (cluster.isMaster) {
      return {
        mode: 'cluster',
        workers: Object.keys(cluster.workers).length,
        pid: process.pid,
      };
    }
    return {
      mode: 'worker',
      pid: process.pid,
    };
  }
}

module.exports = ClusterManager;
