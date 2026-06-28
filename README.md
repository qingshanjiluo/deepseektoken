# DeepSeekToken

OpenAI 兼容的 DeepSeek Web 聊天 API 代理服务。支持多账号池管理、会话复用、限速控制、提示词注入、工具调用、思考内容输出、多语言配置向导等高级功能。

## ✨ 功能特性

- **多账号池管理**：自动切换多个 DeepSeek 账号，支持冷却机制
- **会话管理**：每个代理拥有独立会话，支持自动续写和重置
- **提示词注入**：支持请求头、请求体、环境变量多级注入，新会话自动 bootstrap 预热
- **工具调用**：智能解析 `TOOL_CALL` / JSON / XML 多格式，严格单工具约束
- **思考内容**：完整支持 `reasoning_content`，OpenAI / Anthropic / Responses 三种协议兼容
- **真实 continue 链路**：通过 `/api/v0/chat/continue` 续写，自动降级 fallback
- **代理鉴权**：支持 API Key + Bearer Token + IP 白名单三重防护
- **限速控制**：按模型粒度的 Token Bucket 限速
- **多语言配置向导**：中文 / English / Русский / 日本語 / 한국어 五语言流式引导
- **一键启动**：双击 `.bat` 即可运行，自动装依赖、检测端口、展示配置
- **管理界面**：Web 端实时查看账号、会话、鉴权状态
- **交互式 CLI 客户端**：支持流式对话、模型切换、推理显示、session 查看
- **流式输出**：SSE 实时流式响应
- **Docker 支持**：容器化一键部署

## 🚀 快速开始

### 一键配置

```bash
# 双击运行（Windows）
配置.bat
```

或命令行：

```bash
node scripts/setup-wizard.js
```

### 手动配置

#### 1. 安装依赖

```bash
npm install
```

#### 2. 配置 DeepSeek 账号认证

```bash
# 方式一：Chrome 自动登录抓取（推荐）
node scripts/auth.js --login

# 方式二：从已有文件导入
node scripts/auth.js --import

# 方式三：手动创建 deepseek-auth.json
```

`deepseek-auth.json` 示例：

```json
{
  "token": "your-deepseek-auth-token",
  "cookie": "ds_session_id=xxx; smidV2=xxx",
  "hif_dliq": "",
  "hif_leim": "",
  "wasmUrl": "https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm"
}
```

多账号支持（数组格式）：

```json
[
  { "token": "token1", "cookie": "xxx", "wasmUrl": "..." },
  { "token": "token2", "cookie": "yyy", "wasmUrl": "..." }
]
```

#### 3. 启动服务

```bash
# 交互模式（本地推荐）
node server.js

# 非交互模式（服务器 / VPS）
NON_INTERACTIVE=1 node server.js

# 使用 npm
npm start

# 双击（Windows）
启动.bat
```

Docker 部署：

```bash
docker build -t deepseek-token .
docker run -p 9655:9655 deepseek-token
```

## 📡 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查（含账号/会话/鉴权状态） |
| `GET` | `/v1/models` | OpenAI 兼容模型列表 |
| `GET` | `/v1/model-capabilities` | 真实模型映射和能力查询 |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/messages` | Anthropic Messages（Claude Code 兼容） |
| `POST` | `/v1/responses` | OpenAI Responses API |
| `GET` | `/v1/sessions` | 活跃代理会话列表 |
| `POST` | `/reset-session?agent=<id>` | 重置指定代理会话 |
| `POST` | `/reset-session?agent=all` | 重置所有会话 |
| `GET` | `/admin/accounts` | 账号列表 |
| `POST` | `/admin/accounts/reload` | 重载账号配置 |
| `POST` | `/admin/accounts/:id/toggle` | 启用/禁用账号 |
| `GET` | `/admin/proxy-auth` | 代理鉴权状态 |
| `POST` | `/admin/proxy-auth/generate-api-key` | 生成 API Key |
| `POST` | `/admin/proxy-auth/generate-bearer-token` | 生成 Bearer Token |

### 示例请求

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-agent-session: my-agent" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好！"}],
    "stream": false
  }'
```

流式请求：

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "写一首诗"}],
    "stream": true
  }'
```

## 🛠️ 高级配置

### 环境变量

```env
PORT=9655
HOST=0.0.0.0
DEEPSEEK_AUTH_PATH=./deepseek-auth.json
DEEPSEEK_AUTH_DIR=./accounts/
DEEPSEEK_ACCOUNT_COOLDOWN_MS=600000
DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED=1
DEEPSEEK_DEFAULT_INJECTION_PROMPT=你的全局注入提示词
PROXY_AUTH_PATH=./proxy-auth.json
PROXY_REQUIRE_AUTH=0
NON_INTERACTIVE=0
```

### 提示词注入（优先级从高到低）

1. `x-prompt-override` 请求头 —— 完全替换系统提示词
2. `x-prompt-injection` 请求头 —— 追加到系统提示词末尾
3. 请求体 `prompt_injection` 字段
4. 环境变量 `DEEPSEEK_DEFAULT_INJECTION_PROMPT`（服务端全局默认）
5. 新会话自动 bootstrap 注入

### 代理鉴权

启用鉴权后，所有 POST 端点需要验证：

```bash
# 生成密钥（交互菜单 或 CLI）
node scripts/auth.js        # 菜单第三项
node scripts/setup-wizard.js # 第四步

# 使用 API Key
curl -H "x-api-key: fds_xxx..." http://localhost:9655/v1/chat/completions ...

# 使用 Bearer Token
curl -H "Authorization: Bearer fds_bearer_xxx..." http://localhost:9655/v1/chat/completions ...
```

### 交互式客户端

```bash
node src/client/index.js
node src/client/index.js --agent my-agent --model deepseek-reasoner --reasoning
```

客户端命令：

| 命令 | 说明 |
|------|------|
| `/agent <id>` | 设置代理 ID（会话隔离） |
| `/model <name>` | 切换模型 |
| `/reasoning` | 显示/隐藏推理过程 |
| `/status` | 查看服务状态 |
| `/session` | 查看当前会话信息 |
| `/reset` | 重置当前会话 |
| `/exit` | 退出 |

## 📁 项目结构

```
FreeDeepseekAPI-main/
├── server.js                 # 主入口（代理服务）
├── 配置.bat                   # 一键配置（Windows）
├── 启动.bat                   # 一键启动（Windows）
├── scripts/
│   ├── auth.js               # 认证管理菜单
│   ├── auth_import.js        # 认证文件导入
│   ├── deepseek_chrome_auth.js # Chrome 自动抓取
│   ├── doctor.js             # 诊断工具
│   ├── setup-wizard.js       # 多语言配置向导
│   └── generate-proxy-keys.js # 生成代理密钥
├── src/
│   ├── auth/
│   │   ├── accountPool.js    # 账号池
│   │   ├── accountManager.js # 账号管理器
│   │   ├── authMiddleware.js # 鉴权中间件
│   │   ├── proxyKeyStore.js  # 代理密钥存储
│   │   └── sessionManager.js # 会话管理器
│   ├── config/
│   │   ├── i18n.js           # 多语言文案（5 语言）
│   │   ├── proxy-defaults.js # 代理默认配置
│   │   └── index.js          # 配置文件
│   ├── client/
│   │   └── index.js          # 交互式 CLI 客户端
│   ├── server/
│   │   ├── index.js          # 旧版 Express 实现
│   │   └── rateLimiter.js    # 限速器
│   └── admin/
│       └── index.html        # Web 管理界面
├── tests/
│   ├── unit.test.js          # 基础单元测试
│   └── proxy-upgrade.test.js # 增强功能测试
├── docs/
│   └── api-documentation.md  # API 文档
└── package.json
```

## 🧪 测试

```bash
npm test
```

当前 13/13 测试通过，覆盖：账号池轮询与冷却、会话 TTL 与复用、限速器、工具调解析、continue 载荷构建、bootstrap 注入判定、代理密钥持久化。

## ⚙️ 支持的模型

| 模型 ID | 说明 |
|---------|------|
| `deepseek-chat` | DeepSeek V4 Flash 快速模式 |
| `deepseek-reasoner` | DeepSeek V4 Flash 推理模式 |
| `deepseek-expert` | DeepSeek Web "Эксперт" 专家模式 |
| `deepseek-vision` | 识图模式 |
| `deepseek-chat-search` | 快速模式 + 联网搜索 |
| `deepseek-reasoner-search` | 推理模式 + 联网搜索 |

完整列表：`GET /v1/model-capabilities`

---

## 💬 支持与反馈

- 如有问题，请提交 `https://github.com/qingshanjiluo/Deeper-AgentTeam/issues`。
- 作者：**最中幻想**
- 微信：`andyloveanny`
- 邮箱：[sifangzhiji@qq.com](mailto:sifangzhiji@qq.com)

### ☕ 赞助支持

如果这个项目对你有帮助，欢迎请作者喝一杯咖啡，谢谢 ＾3＾

<p align="left">
  <img src="https://chat.mk49.cyou/static/files/68a2d748ad67a2438ad9e49b/9b8157ca091035857751b6c61028e9e3.jpg" alt="赞助二维码" width="200" style="border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
</p>

### 🔗 友情链接

- `https://github.com/qingshanjiluo/Deeper-AgentTeam.git`
- `http://mk48by049.mbbs.cc`
- `http://china.free.mbbs.ss`
- `https://kimi.com`
- `https://wenshushu.cn`
- `https://airportal.cn`

---

## 📄 许可证

本项目采用 MIT 许可证。详情请参见 [LICENSE](LICENSE) 文件。

---

## 🙏 致谢

- 感谢 [DeepSeek](https://deepseek.com) 提供强大的 AI 服务。
- 感谢所有贡献者的努力。
