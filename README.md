# FreeDeepseekAPI

OpenAI-compatible local API proxy for DeepSeek Web chat with advanced features including account pooling, session management, and rate limiting.

## Features

- **Account Pool Management**: Automatic switching between multiple accounts with cooldown support
- **Session Management**: Persistent conversation sessions with reuse control
- **Rate Limiting**: Per-model rate limits (deepseek-chat: 60 req/min, deepseek-reasoner: 30 req/min)
- **OpenAI-Compatible API**: Drop-in replacement for OpenAI API
- **Interactive CLI**: Easy-to-use command-line client
- **Streaming Support**: Real-time streaming responses
- **Docker Support**: Containerized deployment

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

Create a `.env` file:

```env
PORT=9655
HOST=0.0.0.0
DEEPSEEK_AUTH_PATH=./deepseek-auth.json
DEEPSEEK_ACCOUNT_COOLDOWN_MS=600000
LOG_LEVEL=info
```

### Account Configuration

Create `deepseek-auth.json`:

```json
[
  {
    "token": "your-deepseek-token-1",
    "email": "account1@example.com"
  },
  {
    "token": "your-deepseek-token-2",
    "email": "account2@example.com"
  }
]
```

## Usage

### Start the Server

```bash
# 交互模式（本地推荐）
npm start

# 非交互模式（服务器/VPS）
NON_INTERACTIVE=1 npm start

# 或直接运行主入口
node server.js
```

With Docker:

```bash
docker build -t free-deepseek-api .
docker run -p 9655:9655 free-deepseek-api
```

### 管理 DeepSeek 账号

```bash
# 打开 Chrome 自动登录并抓取认证
node scripts/auth.js --login

# 从已有文件导入
node scripts/auth.js --import

# 诊断认证配置
node scripts/doctor.js
```

### 交互式客户端

```bash
node src/client/index.js
node src/client/index.js --agent my-agent --model deepseek-reasoner --reasoning
```

### API Endpoints

- `GET /health` - 健康检查（含账号/会话/鉴权状态）
- `GET /v1/models` - 支持的 OpenAI 兼容模型列表
- `GET /v1/model-capabilities` - 真实模型映射和能力查询
- `POST /v1/chat/completions` - OpenAI Chat Completions（stream=true|false）
- `POST /v1/messages` - Anthropic Messages（Claude Code 兼容）
- `POST /v1/responses` - OpenAI Responses API
- `GET /v1/sessions` - 活跃代理会话列表
- `POST /reset-session?agent=<id>` - 重置指定代理会话
- `POST /reset-session?agent=all` - 重置所有会话
- `GET /admin/accounts` - 账号列表
- `POST /admin/accounts/reload` - 重载账号
- `POST /admin/accounts/:id/toggle` - 启停账号
- `GET /admin/proxy-auth` - 代理鉴权状态
- `POST /admin/proxy-auth/generate-api-key` - 生成 API Key
- `POST /admin/proxy-auth/generate-bearer-token` - 生成 Bearer Token

### 提示词注入

通过以下方式控制注入提示词（优先级从高到低）：
1. `x-prompt-override: <text>` 请求头（完全覆盖）
2. `x-prompt-injection: <text>` 请求头（追加到系统提示词）
3. 请求体 `prompt_injection` 字段
4. 环境变量 `DEEPSEEK_DEFAULT_INJECTION_PROMPT`（全局默认）
5. 新会话自动 bootstrap 注入（可通过 `DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED=0` 关闭）

### 代理鉴权

启用 `PROXY_REQUIRE_AUTH=1` 或通过管理接口启用后，所有 POST API 端点的调用者需要提供：
- `x-api-key: <key>` 请求头
- 或 `Authorization: Bearer <token>` 请求头

### Example API Call

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

## Development

### Running Tests

```bash
npm test
```

### Project Structure

```
FreeDeepseekAPI-main/
├── src/
│   ├── auth/
│   │   ├── accountPool.js
│   │   └── sessionManager.js
│   ├── config/
│   │   └── index.js
│   ├── server/
│   │   ├── index.js
│   │   └── rateLimiter.js
│   ├── client/
│   │   └── index.js
│   └── utils/
│       └── logger.js
├── tests/
│   └── unit.test.js
├── logs/
├── .env
├── package.json
├── Dockerfile
└── README.md
```

## License

MIT
