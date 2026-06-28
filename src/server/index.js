const express = require('express');
const cors = require('cors');
const config = require('../config');
const logger = require('../utils/logger');
const AccountPool = require('../auth/accountPool');
const SessionManager = require('../auth/sessionManager');
const RateLimiter = require('./rateLimiter');
const DeepSeekClient = require('../deepseek/client');

const app = express();
const accountPool = new AccountPool(config);
const sessionManager = new SessionManager({ reuseEnabled: true });
const rateLimiter = new RateLimiter();

app.use(cors());
app.use(express.json());

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    accounts: accountPool.getAllAccounts().length,
    available: accountPool.getAvailableCount(),
    sessions: sessionManager.getStats(),
  });
});

// 模型列表
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      { id: 'deepseek-chat', object: 'model' },
      { id: 'deepseek-reasoner', object: 'model' },
    ],
  });
});

// 会话管理端点
app.post('/v1/sessions', (req, res) => {
  const { account, metadata } = req.body;
  if (!account) {
    return res.status(400).json({ error: 'Account is required' });
  }
  const session = sessionManager.createSession(account, metadata);
  res.json({ sessionId: session.id, session });
});

app.get('/v1/sessions/:sessionId', (req, res) => {
  const session = sessionManager.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ session });
});

app.delete('/v1/sessions/:sessionId', (req, res) => {
  const deleted = sessionManager.deleteSession(req.params.sessionId);
  res.json({ deleted });
});

app.post('/v1/sessions/reuse', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  sessionManager.setReuseEnabled(enabled);
  res.json({ reuseEnabled: sessionManager.isReuseEnabled() });
});

// 限速状态
app.get('/v1/rate-limit/:model', (req, res) => {
  const account = accountPool.getNextAccount();
  if (!account) {
    return res.status(503).json({ error: 'No available accounts' });
  }
  const stats = rateLimiter.getStats(req.params.model, account.token || 'default');
  res.json(stats);
});

// 聊天补全
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model = 'deepseek-chat', sessionId, messages, stream = false } = req.body;
    
    // 获取账户
    let account = null;
    let session = null;
    
    if (sessionId) {
      session = sessionManager.getSession(sessionId);
      if (session && sessionManager.isReuseEnabled()) {
        account = session.account;
      }
    }
    
    if (!account) {
      account = accountPool.getNextAccount();
    }
    
    if (!account) {
      return res.status(503).json({ error: 'No available accounts' });
    }
    
    // 限速检查
    const accountId = account.token || 'default';
    if (!rateLimiter.canMakeRequest(model, accountId)) {
      const waitTime = rateLimiter.getWaitTime(model, accountId);
      return res.status(429).json({
        error: 'Rate limit exceeded',
        waitTime,
        message: `Please wait ${waitTime}ms before making another request to ${model}`,
      });
    }
    
    // 创建会话（如果没有）
    if (!session && sessionManager.isReuseEnabled()) {
      session = sessionManager.createSession(account, { model, messages: messages?.length || 0 });
    }
    
    // 实现实际的 DeepSeek API 调用
    const deepseekClient = new DeepSeekClient(account);
    
    try {
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const streamBody = await deepseekClient.chatStream(messages, model);
        streamBody.pipe(res);
        streamBody.on('end', () => {
          res.write('data: [DONE]\n\n');
          res.end();
        });
        return;
      }
      
      const result = await deepseekClient.chat(messages, model);
      res.json(result);
    } catch (apiError) {
      logger.error(`DeepSeek API call failed: ${apiError.message}`);
      // 标记账号冷却
      accountPool.markCooldown(account, config.auth.cooldownMs || 600000);
      
      // 尝试备用账号
      const fallbackAccount = accountPool.getNextAccount();
      if (fallbackAccount && fallbackAccount !== account) {
        logger.info(`Retrying with fallback account: ${fallbackAccount.token?.slice(0, 10)}...`);
        const fallbackClient = new DeepSeekClient(fallbackAccount);
        try {
          if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            const streamBody = await fallbackClient.chatStream(messages, model);
            streamBody.pipe(res);
            streamBody.on('end', () => {
              res.write('data: [DONE]\n\n');
              res.end();
            });
            return;
          }
          const result = await fallbackClient.chat(messages, model);
          res.json(result);
          return;
        } catch (fallbackError) {
          logger.error(`Fallback account also failed: ${fallbackError.message}`);
          accountPool.markCooldown(fallbackAccount, config.auth.cooldownMs || 600000);
        }
      }
      
      throw apiError;
    }
    
    // 流式响应
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const content = response.choices[0].message.content;
      const words = content.split(' ');
      for (let i = 0; i < words.length; i++) {
        const chunk = {
          id: response.id,
          object: 'chat.completion.chunk',
          created: response.created,
          model,
          choices: [{ index: 0, delta: { content: (i === 0 ? '' : ' ') + words[i] }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        await new Promise(r => setTimeout(r, 50));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    
    res.json(response);
  } catch (error) {
    logger.error(`Chat completion error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

const PORT = config.server.port;
const HOST = config.server.host;

app.listen(PORT, HOST, () => {
  logger.info(`FreeDeepseekAPI server running on http://${HOST}:${PORT}`);
  logger.info(`Loaded ${accountPool.getAllAccounts().length} accounts`);
  logger.info(`Session reuse: ${sessionManager.isReuseEnabled() ? 'enabled' : 'disabled'}`);
});
