const WebSocket = require('ws');
const logger = require('../utils/logger');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Set();
    this.setup();
  }

  setup() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info(`WebSocket client connected (${this.clients.size} total)`);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (e) {
          ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info(`WebSocket client disconnected (${this.clients.size} total)`);
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
      });

      ws.send(JSON.stringify({ type: 'connected', message: 'Connected to FreeDeepseekAPI WebSocket' }));
    });
  }

  handleMessage(ws, data) {
    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      case 'subscribe':
        ws.send(JSON.stringify({ type: 'subscribed', channel: data.channel }));
        break;
      default:
        ws.send(JSON.stringify({ type: 'echo', data: data.payload || data }));
    }
  }

  broadcast(message) {
    const msg = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  getStats() {
    return {
      totalClients: this.clients.size,
    };
  }
}

module.exports = WebSocketServer;
