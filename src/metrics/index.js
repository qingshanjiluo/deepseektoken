const client = require('prom-client');
const logger = require('../utils/logger');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const activeSessions = new client.Gauge({
  name: 'active_sessions',
  help: 'Number of active sessions',
});

const accountPoolSize = new client.Gauge({
  name: 'account_pool_size',
  help: 'Total number of accounts in the pool',
  labelNames: ['status'],
});

const rateLimitExceeded = new client.Counter({
  name: 'rate_limit_exceeded_total',
  help: 'Total number of rate limit exceeded events',
  labelNames: ['model', 'account_id'],
});

const apiCallDurationSeconds = new client.Histogram({
  name: 'api_call_duration_seconds',
  help: 'Duration of API calls to DeepSeek in seconds',
  labelNames: ['model', 'success'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

const apiCallErrors = new client.Counter({
  name: 'api_call_errors_total',
  help: 'Total number of API call errors',
  labelNames: ['model', 'error_type'],
});

register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestDurationSeconds);
register.registerMetric(activeSessions);
register.registerMetric(accountPoolSize);
register.registerMetric(rateLimitExceeded);
register.registerMetric(apiCallDurationSeconds);
register.registerMetric(apiCallErrors);

function metricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.route.path : req.path;
    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
    httpRequestDurationSeconds.observe({ method: req.method, route, status_code: res.statusCode }, duration);
  });
  next();
}

function updateActiveSessions(count) {
  activeSessions.set(count);
}

function updateAccountPoolMetrics(stats) {
  accountPoolSize.set({ status: 'total' }, stats.total);
  accountPoolSize.set({ status: 'available' }, stats.available);
  accountPoolSize.set({ status: 'cooldown' }, stats.inCooldown || 0);
  accountPoolSize.set({ status: 'disabled' }, (stats.total - stats.enabled) || 0);
}

function recordRateLimitExceeded(model, accountId) {
  rateLimitExceeded.inc({ model, account_id: accountId });
}

function recordAPICallDuration(model, success, duration) {
  apiCallDurationSeconds.observe({ model, success: success ? 'true' : 'false' }, duration);
}

function recordAPICallError(model, errorType) {
  apiCallErrors.inc({ model, error_type: errorType });
}

function metricsHandler(req, res) {
  res.set('Content-Type', register.contentType);
  res.end(register.metrics());
}

module.exports = {
  register,
  metricsMiddleware,
  metricsHandler,
  updateActiveSessions,
  updateAccountPoolMetrics,
  recordRateLimitExceeded,
  recordAPICallDuration,
  recordAPICallError,
};
