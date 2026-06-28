const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const serverModule = require('../server');

test('parseToolCall 只保留第一个合法工具调用', () => {
  const parseToolCall = serverModule.__test?.parseToolCall;
  assert.equal(typeof parseToolCall, 'function');

  const text = [
    '先说明一下思路，但不要执行多个工具。',
    '{"tool_call":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}',
    '{"tool_call":{"name":"browser_click","arguments":{"selector":"#next"}}}',
  ].join('\n');

  const toolCall = parseToolCall(text);
  assert.deepEqual(toolCall, {
    name: 'browser_navigate',
    arguments: JSON.stringify({ url: 'https://example.com' }),
  });
});

test('buildContinuePayload 使用网页端 continue 所需字段', () => {
  const buildContinuePayload = serverModule.__test?.buildContinuePayload;
  assert.equal(typeof buildContinuePayload, 'function');

  assert.deepEqual(buildContinuePayload('session-1', 42), {
    chat_session_id: 'session-1',
    message_id: 42,
    fallback_to_resume: true,
  });
});

test('shouldBootstrapSession 仅在新会话首轮触发隐藏注入', () => {
  const shouldBootstrapSession = serverModule.__test?.shouldBootstrapSession;
  assert.equal(typeof shouldBootstrapSession, 'function');

  assert.equal(
    shouldBootstrapSession({
      id: 'chat-1',
      bootstrapInjected: false,
      messageCount: 0,
    }),
    true,
  );

  assert.equal(
    shouldBootstrapSession({
      id: 'chat-1',
      bootstrapInjected: true,
      messageCount: 1,
    }),
    false,
  );
});

test('ProxyKeyStore 可以持久化代理 API Key 与 Bearer Token', async () => {
  const { ProxyKeyStore } = require('../src/auth/proxyKeyStore');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-proxy-keys-'));
  const filePath = path.join(tempDir, 'proxy-auth.json');

  const store = new ProxyKeyStore({ filePath });
  await store.load();
  const apiKey = store.generateApiKey();
  const bearerToken = store.generateBearerToken();
  store.addApiKey(apiKey);
  store.addBearerToken(bearerToken);
  await store.save();

  const reloaded = new ProxyKeyStore({ filePath });
  await reloaded.load();

  assert.equal(reloaded.getConfig().apiKeys.includes(apiKey), true);
  assert.equal(reloaded.getConfig().bearerTokens.includes(bearerToken), true);
});
