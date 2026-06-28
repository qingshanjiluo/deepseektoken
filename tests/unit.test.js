const test = require('node:test');
const assert = require('node:assert/strict');
const AccountPool = require('../src/auth/accountPool');
const SessionManager = require('../src/auth/sessionManager');
const RateLimiter = require('../src/server/rateLimiter');

test('AccountPool 可以创建实例', () => {
  const config = {
    auth: {
      path: './test-auth.json',
    },
  };
  const pool = new AccountPool(config);
  assert.ok(pool);
});

test('AccountPool 按轮询返回不同账号', () => {
  const pool = new AccountPool({ auth: { path: null } });
  pool.accounts = [
    { token: 'token1', cooldownUntil: 0 },
    { token: 'token2', cooldownUntil: 0 },
    { token: 'token3', cooldownUntil: 0 },
  ];
  const account1 = pool.getNextAccount();
  const account2 = pool.getNextAccount();
  assert.notStrictEqual(account1.token, account2.token);
});

test('AccountPool 会跳过冷却中的账号', () => {
  const pool = new AccountPool({ auth: { path: null } });
  pool.accounts = [
    { token: 'token1', cooldownUntil: Date.now() + 100000 },
    { token: 'token2', cooldownUntil: 0 },
  ];
  const account = pool.getNextAccount();
  assert.strictEqual(account.token, 'token2');
});

test('SessionManager 可以创建并读取会话', () => {
  const manager = new SessionManager();
  const session = manager.createSession({ token: 'test' });
  const retrieved = manager.getSession(session.id);
  assert.strictEqual(retrieved.id, session.id);
});

test('SessionManager 会在 TTL 后清理会话', async () => {
  const manager = new SessionManager({ defaultTTL: 100 });
  const session = manager.createSession({ token: 'test' });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const retrieved = manager.getSession(session.id);
  assert.strictEqual(retrieved, null);
});

test('SessionManager 支持复用开关', () => {
  const manager = new SessionManager({ reuseEnabled: true });
  assert.strictEqual(manager.isReuseEnabled(), true);
  manager.setReuseEnabled(false);
  assert.strictEqual(manager.isReuseEnabled(), false);
});

test('RateLimiter 允许限额内请求', () => {
  const limiter = new RateLimiter();
  const canMake = limiter.canMakeRequest('deepseek-chat', 'account1');
  assert.strictEqual(canMake, true);
});

test('RateLimiter 会执行按模型限流', () => {
  const limiter = new RateLimiter({
    limits: {
      'deepseek-chat': { requestsPerMinute: 1 },
    },
  });
  limiter.canMakeRequest('deepseek-chat', 'account1');
  const second = limiter.canMakeRequest('deepseek-chat', 'account1');
  assert.strictEqual(second, false);
});

test('RateLimiter 会返回等待时间', () => {
  const limiter = new RateLimiter({
    limits: {
      'deepseek-chat': { requestsPerMinute: 1 },
    },
  });
  limiter.canMakeRequest('deepseek-chat', 'account1');
  const waitTime = limiter.getWaitTime('deepseek-chat', 'account1');
  assert.ok(waitTime > 0);
});
