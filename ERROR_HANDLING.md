# 错误处理与日志完善计划

## 当前状态

项目已实现基本的错误处理和日志记录，但仍有以下方面可以完善。

## 错误处理优化

### 1. 统一错误响应格式

**问题**：错误响应格式不统一，客户端难以处理。

**优化方案**：

```javascript
// 统一错误响应格式
class APIError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

// 错误响应格式
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded",
    "status": 429,
    "timestamp": "2026-06-27T10:00:00.000Z",
    "details": {
      "retryAfter": 60000
    }
  }
}
```

### 2. 全局错误处理中间件

```javascript
// 全局错误处理
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  if (err instanceof APIError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        status: err.statusCode,
        timestamp: err.timestamp,
        details: err.details,
      },
    });
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      status: 500,
      timestamp: new Date().toISOString(),
    },
  });
});
```

### 3. 输入验证

```javascript
// 请求体验证
const validateChatRequest = (req, res, next) => {
  const { model, messages } = req.body;
  
  if (!model) {
    throw new APIError(400, 'MISSING_MODEL', 'Model is required');
  }
  
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new APIError(400, 'MISSING_MESSAGES', 'Messages are required');
  }
  
  // 验证消息格式
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      throw new APIError(400, 'INVALID_MESSAGE', 'Each message must have role and content');
    }
  }
  
  next();
};
```

### 4. 异步错误处理

```javascript
// 包装异步函数
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 使用示例
app.post('/v1/chat/completions', asyncHandler(async (req, res) => {
  // 处理请求
}));
```

## 日志优化

### 1. 结构化日志

```javascript
// 结构化日志格式
logger.info('Chat completion request', {
  event: 'chat_completion_request',
  model: req.body.model,
  messages: req.body.messages.length,
  sessionId: req.body.sessionId,
  userId: req.user?.id,
  ip: req.ip,
});

logger.info('Chat completion response', {
  event: 'chat_completion_response',
  model: model,
  duration: Date.now() - startTime,
  tokens: response.usage.total_tokens,
  status: 'success',
});
```

### 2. 日志级别配置

```javascript
// 日志级别
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// 动态调整日志级别
const setLogLevel = (level) => {
  logger.level = level;
  logger.info(`Log level changed to: ${level}`);
};
```

### 3. 日志存储

```javascript
// 日志轮转
const DailyRotateFile = require('winston-daily-rotate-file');

const transport = new DailyRotateFile({
  filename: 'logs/application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
});
```

### 4. 敏感信息脱敏

```javascript
// 脱敏工具
const redactSensitive = (data) => {
  if (typeof data !== 'object') return data;
  
  const sensitiveKeys = ['token', 'password', 'apiKey', 'cookie'];
  const redacted = { ...data };
  
  for (const key of sensitiveKeys) {
    if (redacted[key]) {
      redacted[key] = '[REDACTED]';
    }
  }
  
  return redacted;
};
```

## 监控与告警

### 1. 错误告警

```javascript
// 错误告警
const alertOnError = (error) => {
  if (error.statusCode >= 500) {
    // 发送告警
    sendAlert({
      title: 'API Error',
      message: error.message,
      severity: 'critical',
      timestamp: new Date().toISOString(),
    });
  }
};
```

### 2. 性能监控

```javascript
// 性能监控
const performanceMonitor = {
  requestCount: 0,
  errorCount: 0,
  responseTimes: [],
  
  recordRequest(duration, success) {
    this.requestCount++;
    if (!success) this.errorCount++;
    this.responseTimes.push(duration);
    
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }
  },
  
  getStats() {
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const avg = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.errorCount / this.requestCount,
      avgResponseTime: avg,
      p95ResponseTime: p95,
    };
  },
};
```

## 错误恢复

### 1. 重试机制

```javascript
// 重试工具
const retry = async (fn, maxRetries = 3, delay = 1000) => {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`Retry attempt ${i + 1}/${maxRetries} failed`, {
        error: error.message,
        retry: i + 1,
      });
      
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  }
  
  throw lastError;
};
```

### 2. 降级策略

```javascript
// 降级策略
const fallbackHandler = async (req, res, next) => {
  try {
    // 尝试主要逻辑
    await handleChatRequest(req, res);
  } catch (error) {
    logger.error('Primary handler failed, using fallback', { error: error.message });
    
    // 降级处理
    res.status(200).json({
      message: 'Using fallback response',
      choices: [{
        message: {
          role: 'assistant',
          content: 'Service is temporarily degraded. Please try again later.',
        },
      }],
    });
  }
};
```

## 执行计划

### 短期 (1 周)
1. 实现统一错误响应格式
2. 添加全局错误处理中间件
3. 完善输入验证

### 中期 (2 周)
1. 实现结构化日志
2. 添加日志轮转
3. 配置监控告警

### 长期 (1 月)
1. 实现错误恢复机制
2. 完善性能监控
3. 优化日志查询效率