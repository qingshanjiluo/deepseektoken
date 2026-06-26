# FreeDeepseekAPI

<p align="center">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

<p align="center">
  <strong>本地 OpenAI 兼容 API 代理，用于 DeepSeek Web Chat</strong>
</p>

<p align="center">
  <a href="https://github.com/ForgetMeAI/FreeDeepseekAPI/blob/main/LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green.svg" /></a>
  <img alt="Node.js 18 plus" src="https://img.shields.io/badge/node-18%2B-339933.svg" />
  <img alt="No npm dependencies" src="https://img.shields.io/badge/dependencies-0-blue.svg" />
  <img alt="OpenAI compatible" src="https://img.shields.io/badge/OpenAI-compatible-111111.svg" />
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> •
  <a href="#-功能特点">功能特点</a> •
  <a href="#-请求示例">请求示例</a> •
  <a href="#-模型">模型</a> •
  <a href="#-接口端点">接口端点</a> •
  <a href="#-open-webui">Open WebUI</a>
</p>

FreeDeepseekAPI 在本地启动一个 API 服务器，用于 **DeepSeek Web Chat**（`chat.deepseek.com`），并允许将 DeepSeek Web 连接到 Open WebUI、LiteLLM、Hermes、Claude Code、OpenAI SDK 风格客户端以及其他 OpenAI 兼容工具。

该项目通过您在自己独立 Chrome 配置文件中已登录的普通 DeepSeek 账户工作。本地服务器接收 API 请求，然后通过保存的浏览器会话自动向 DeepSeek Web 发送请求。

> ⚠️ 这是一个实验性质的 Web Chat 代理。DeepSeek 可能随时更改其内部 Web API 而不预先通知。对于生产环境，建议使用 DeepSeek 官方付费 API。

ForgetMeAI: https://t.me/forgetmeai

---

## 导航

- [它能做什么](#-它能做什么)
- [功能特点](#-功能特点)
- [快速开始](#-快速开始)
- [Windows 启动](#-windows-启动)
- [Linux / Chromium 启动](#-linux--chromium-启动)
- [VPS / 无头模式启动](#-vps--无头模式启动)
- [诊断 / 医生](#-诊断--医生)
- [会话复用与聊天重置](#-会话复用与聊天重置)
- [多账户池](#-多账户池)
- [控制台登录思路](#-控制台登录思路)
- [验证运行](#-验证运行)
- [请求示例](#-请求示例)
  - [Chat Completions](#chat-completions)
  - [推理（Reasoning）](#推理reasoning)
  - [网页搜索](#网页搜索)
  - [流式输出](#流式输出)
  - [Anthropic Messages API](#anthropic-messages-api)
  - [OpenAI Responses API](#openai-responses-api)
  - [工具调用](#工具调用)
- [模型](#-模型)
- [接口端点](#-接口端点)
- [Open WebUI](#-open-webui)
- [更新登录状态](#-更新登录状态)
- [项目状态](#-项目状态)

---

## ✨ 它能做什么

- 将 DeepSeek Web 作为本地 API 端点使用。
- 将 DeepSeek 连接到 Open WebUI 及其他 OpenAI 兼容客户端。
- 获取标准 JSON 响应或流式 SSE 响应。
- 使用推理模型并获取独立的 `reasoning_content`。
- 提供 Anthropic Messages API 适配层，用于 Claude Code / Anthropic SDK。
- 提供 OpenAI Responses API 适配层，用于新的 OpenAI/Codex 风格客户端。
- 为不同的代理/用户维护独立的 Web 会话。

## 🚀 功能特点

- **OpenAI 兼容 API**：`POST /v1/chat/completions`
- **Anthropic 兼容适配层**：`POST /v1/messages`
- **OpenAI Responses 适配层**：`POST /v1/responses`
- **流式输出**：支持 SSE 分块和普通非流式 JSON 响应
- **推理内容输出**：对思考模型返回独立的 `reasoning_content`
- **工具调用**：解析 OpenAI tools、Anthropic tools 和 Responses 函数工具
- **模型能力查询**：`GET /v1/model-capabilities` 返回别名到真实 Web 模式的映射
- **代理会话**：为每个 `user` 或代理 ID 维护独立的 DeepSeek 会话
- **会话恢复**：自动重置过期或损坏的链/会话
- **零依赖**：仅需 Node.js 18+，无需安装任何 npm 依赖

---

## ⚡ 快速开始

```bash
git clone https://github.com/ForgetMeAI/FreeDeepseekAPI.git
cd FreeDeepseekAPI
npm run auth
npm start
```

`npm run auth` 打开登录菜单：

1. 选择选项 `1`；
2. 在独立的 Chrome 配置文件中登录 DeepSeek；
3. 发送一条短消息，例如 `ok`；
4. 返回终端并按 Enter。

`npm start` 显示启动菜单：

- `1` — 登录/更新 DeepSeek 登录状态
- `2` — 显示模型和状态
- `3` — 启动代理服务器
- `4` — 退出

无交互/CI 环境启动（不显示菜单）：

```bash
NON_INTERACTIVE=1 npm start
# 或
SKIP_ACCOUNT_MENU=1 npm start
```

默认服务器监听地址：

```text
http://localhost:9655
```

---

## 🪟 Windows 启动

```powershell
git clone https://github.com/ForgetMeAI/FreeDeepseekAPI.git
cd FreeDeepseekAPI
npm run auth
npm start
```

如果 Chrome 未安装在标准路径，请显式指定路径：

```powershell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run auth
```

如果找不到 Chrome，`npm run auth` 现在会输出针对 Windows/macOS/Linux 的详细指引，而不是神秘的堆栈跟踪。

---

## 🐧 Linux / Chromium 启动

```bash
git clone https://github.com/ForgetMeAI/FreeDeepseekAPI.git
cd FreeDeepseekAPI
CHROME_PATH=$(which chromium) npm run auth
npm start
```

如果 Chromium 可执行文件名称不同：

```bash
CHROME_PATH=$(which chromium-browser) npm run auth
# 或
CHROME_PATH=$(which google-chrome) npm run auth
```

---

## 🖥 VPS / 无头模式启动

在没有 GUI/Chrome 的服务器上最可靠的流程：

1. 在带有 GUI/Chrome 的本地电脑上执行：

```bash
npm run auth
```

2. 将 `deepseek-auth.json` 复制到 VPS：

```bash
scp deepseek-auth.json user@your-vps:/opt/FreeDeepseekAPI/deepseek-auth.json
```

3. 在 VPS 上导入/验证文件并设置安全权限：

```bash
cd /opt/FreeDeepseekAPI
npm run auth:import -- --input ./deepseek-auth.json
npm run doctor -- --offline
```

4. 以非交互模式启动代理：

```bash
NON_INTERACTIVE=1 npm start
```

您也可以导入浏览器导出的 cookies 文件，而不仅仅是 `deepseek-auth.json`：

```bash
DEEPSEEK_TOKEN="<token>" npm run auth:import -- --input ./cookies.json
```

> 重要：`deepseek-auth.json` 包含您 DeepSeek Web 登录的访问凭证。切勿提交到版本控制，切勿公开，请以 `0600` 权限保存。

---

## 🩺 诊断 / 医生

```bash
npm run doctor
# 不向 DeepSeek 发送网络请求：
npm run doctor -- --offline
```

`doctor` 会检查：

- 是否找到 `deepseek-auth.json` / `DEEPSEEK_AUTH_DIR`；
- 是否为有效的 JSON；
- 是否包含 `token`、`cookie`、`wasmUrl`；
- macOS/Linux 上文件权限是否安全（`0600`）；
- 普通运行时，DeepSeek PoW 端点是否可访问。

如果遇到 `data.biz_data is null`、`fetch failed`、`401/403/429` 或 Hermes/OpenCode 看不到模型，请首先运行 `npm run doctor`。

---

## ♻️ 会话复用与聊天重置

FreeDeepseekAPI 不会无理由地为每个 HTTP 请求创建新的 DeepSeek 聊天。逻辑如下：

- 一个 `x-agent-session`、`session` 或 `user` → 对应一个 DeepSeek 聊天会话；
- 如果 session id 已存在，代理会复用该会话，并通过 `parent_message_id` 继续对话链；
- 当 TTL 过期、DeepSeek 会话出错或消息链过长时会自动重置；
- 本地历史会保留短上下文，以便新的 DeepSeek 会话能够继续对话。

显式指定 agent/session：

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-agent-session: my-agent" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

查看活跃 sessions：

```bash
curl http://localhost:9655/v1/sessions
```

重置单个 session：

```bash
curl -X POST "http://localhost:9655/reset-session?agent=my-agent"
```

重置所有 sessions：

```bash
curl -X POST "http://localhost:9655/reset-session?agent=all"
```

为什么 DeepSeek Web 中仍然会出现聊天记录：代理通过内部 Web Chat API 工作，而 DeepSeek 自身会存储真实的聊天会话。这对于 Web 代理来说是正常的。会话复用的目的是避免无谓地创建新聊天，并在链过期或损坏时谨慎重置。

---

## 👥 多账户池

可以连接多个 auth 文件。正确的模式是每个 agent/session 固定使用一个账户（sticky）——代理不会在活跃的 DeepSeek 会话中切换账户。如果账户遇到 `401/403/429` 并进入冷却状态，会话会被安全重置，新请求可能切换到其他可用账户。

方式 1 — 存放 auth 文件的目录：

```bash
mkdir -p accounts
cp deepseek-auth-main.json accounts/main.json
cp deepseek-auth-backup.json accounts/backup.json
chmod 600 accounts/*.json
DEEPSEEK_AUTH_DIR=./accounts NON_INTERACTIVE=1 npm start
```

方式 2 — 文件列表：

```bash
DEEPSEEK_AUTH_PATH="./accounts/main.json,./accounts/backup.json" NON_INTERACTIVE=1 npm start
```

池的工作方式：

- 新的 agent/session 通过轮询（round-robin）获得一个可用账户；
- 选中的账户会固定（sticky）绑定到该 session；
- 当遇到 `401`、`403`、`429` 时，账户进入冷却；
- 如果某个 session 的固定账户进入冷却，旧的 DeepSeek 会话会被重置，以避免继续向速率受限/过期的账户发送请求；
- 账户状态可在 `/health` 中查看，但不会暴露 auth 文件路径或文件名；
- auth 文件必须以 `0600` 权限保存。

配置冷却时间：

```bash
DEEPSEEK_ACCOUNT_COOLDOWN_MS=600000 npm start
```

---

## 🔑 控制台登录思路

PR #3 中的密码登录流程可以实现，但更安全的做法是不存储密码，且不作为默认方式。推荐的实现方式：

1. `npm run auth:console` 通过隐藏提示询问邮箱/手机号和密码。
2. 密码仅保存在进程内存中，不写入文件/logs/history。
3. 脚本通过 `fetch`/CDP 重复 Web 登录流程：获取验证码/验证挑战，向用户提供链接/代码，等待确认。
4. 登录成功后，仅保存标准格式的 `deepseek-auth.json`。
5. 如果 DeepSeek 要求验证码/2FA，脚本会诚实地提示“请打开链接，完成验证，然后按 Enter”，而不是尝试绕过防护。
6. 对于 VPS，最佳实践是使用 `auth:console --no-save-password --output deepseek-auth.json`。

最小安全 MVP：控制台登录仅为交互式，不使用环境变量密码。可接受的自动化方式：`DEEPSEEK_EMAIL=... npm run auth:console`，但密码仍需通过隐藏提示输入。

---

## ✅ 验证运行

```bash
curl http://localhost:9655/
curl http://localhost:9655/v1/models
curl http://localhost:9655/v1/model-capabilities
```

如果一切正常，`/health` 会返回服务器状态、支持的别名列表以及 `config_ready: true`。

---

## 🧪 请求示例

### Chat Completions

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好！请用一句话回答。"}],
    "stream": false
  }'
```

### 推理（Reasoning）

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "简短回答：为什么天空是蓝色的？"}],
    "stream": false
  }'
```

对于推理模型，API 会将思考链与最终答案分开返回：

- non-stream：`choices[0].message.reasoning_content`
- stream：`choices[0].delta.reasoning_content`
- usage：`usage.completion_tokens_details.reasoning_tokens`

`reasoning_tokens` 是根据从 DeepSeek Web 提取的 `THINK` 文本估算的，因为 Web 流不会单独报告推理的 token 用量。

### 网页搜索

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat-search",
    "messages": [{"role": "user", "content": "查找一个关于 DeepSeek 的最新事实并简要回答。"}],
    "stream": false
  }'
```

### 流式输出

```bash
curl -N -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "讲一个简短的笑话。"}],
    "stream": true
  }'
```

### Anthropic Messages API

```bash
curl -X POST http://localhost:9655/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "max_tokens": 512,
    "messages": [{"role": "user", "content": "只回答 OK"}],
    "stream": false
  }'
```

对于 Claude Code，可以直接指定后端：

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:9655"
export ANTHROPIC_AUTH_TOKEN="dummy-key"
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
claude --model deepseek-chat
```

### OpenAI Responses API

```bash
curl -X POST http://localhost:9655/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "input": "只回答 OK",
    "stream": false
  }'
```

### 工具调用

FreeDeepseekAPI 接受：

- OpenAI `tools`；
- Anthropic `tools`；
- Responses API function tools。

代理会请求 DeepSeek 返回严格的 JSON 工具调用，同时也支持解析回退格式：

- `TOOL_CALL:`
- fenced JSON
- `<tool_call>...</tool_call>`

---

## 🧠 模型

`GET /v1/models` 仅返回当前通过此代理验证可用的别名。

### 工作别名

| 别名 | Web 模式 | 推理 | 网页搜索 | 备注 |
| --- | --- | --- | --- | --- |
| `deepseek-chat` | `Быстрый` / `default` | 否 | 否 | 基础聊天 |
| `deepseek-v3` | `Быстрый` / `default` | 否 | 否 | 兼容别名 |
| `deepseek-default` | `Быстрый` / `default` | 否 | 否 | 兼容别名 |
| `deepseek-reasoner` | `Быстрый` / `default` | 是 | 否 | `thinking_enabled=true` |
| `deepseek-r1` | `Быстрый` / `default` | 是 | 否 | R1 兼容别名 |
| `deepseek-chat-search` | `Быстрый` / `default` | 否 | 是 | 网页搜索 |
| `deepseek-default-search` | `Быстрый` / `default` | 否 | 是 | 网页搜索别名 |
| `deepseek-reasoner-search` | `Быстрый` / `default` | 是 | 是 | 推理 + 搜索 |
| `deepseek-r1-search` | `Быстрый` / `default` | 是 | 是 | R1 兼容 + 搜索 |
| `deepseek-expert` | `Эксперт` / `expert` | 否 | 否 | 专家模式 |
| `deepseek-v4-pro` | `Эксперт` / `expert` | 是 | 否 | 专家 + 推理 |

完整映射：

```bash
curl http://localhost:9655/v1/model-capabilities
```

根据 DeepSeek V4 Preview 官方页面，`deepseek-chat` 和 `deepseek-reasoner` 目前路由到 `deepseek-v4-flash`（非思考/思考模式）。在 `chat.deepseek.com` 的直接流中，不返回确切的检查点名称（`model: ""`），因此代理同时记录 Web 模式（`default` / `Быстрый`）和当前官方路由（`DeepSeek-V4-Flash`）。

当前 DeepSeek Web 远程配置显示的 Web 模式：

- `default` / UI `Быстрый` — 可用；支持 `thinking_enabled` 和 `search_enabled`。
- `expert` / UI `Эксперт` — 通过当前 Web 合约（`x-client-version=2.0.0`）可用，并支持 `thinking_enabled`。在 `/v1/models` 中提供不带推理的 `deepseek-expert` 和带推理的 `deepseek-v4-pro`（Expert + reasoning）。
- `vision` / UI `Распознавание` — 在远程配置中可见，但当前直接 Web API 返回 `backend_err_by_model`（`Vision is temporarily unavailable`）。因此 `deepseek-vision` 已从 `/v1/models` 中隐藏。

Expert 模式的搜索在远程配置中不可用，因此 `deepseek-expert-search` 仍不被支持。

---

## 🔌 接口端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/` 或 `/health` | 代理状态 |
| `GET` | `/v1/models` | 可用的 OpenAI 兼容别名列表 |
| `GET` | `/v1/model-capabilities` | 别名、真实模型、能力完整映射 |
| `POST` | `/v1/chat/completions` | OpenAI 兼容的 Chat Completions |
| `POST` | `/v1/messages` | Anthropic Messages API 适配层 |
| `POST` | `/v1/responses` | OpenAI Responses API 适配层 |
| `GET` | `/v1/sessions` | 活跃的本地 agent sessions |
| `POST` | `/reset-session?agent=<id>` | 重置单个 session |
| `POST` | `/reset-session?agent=all` | 重置所有 sessions |

---

## 🖥 Open WebUI

在 Docker 中运行 Open WebUI 时的 Base URL：

```text
http://host.docker.internal:9655/v1
```

本地非 Docker 运行时：

```text
http://localhost:9655/v1
```

API key 可随意填写：代理会通过保存的浏览器会话自动访问 DeepSeek Web。

---

## 🔐 更新登录状态

```bash
npm run auth
npm start
```

如果 DeepSeek 开始返回 `401`、`403` 或要求新的 PoW/会话，请重新执行 `npm run auth` 并更新保存的浏览器会话。

本地认证文件不应提交到 GitHub：

- `deepseek-auth.json`
- `.chrome-profile-deepseek/`
- `.env`

它们已加入 `.gitignore`。

---

## 🧪 测试

语法检查：

```bash
npm test
```

针对运行中的本地代理进行实时烟雾测试：

```bash
BASE_URL=http://127.0.0.1:9655 MODEL=deepseek-chat npm run test:live
```

---

## 📌 项目状态

FreeDeepseekAPI 是一个实验性的 Web Chat 代理，用于本地使用和集成。它依赖于 DeepSeek Web Chat 的当前接口约定，因此当 DeepSeek 方面发生变更时，可能需要更新认证/会话逻辑或模型映射。

如果某项功能突然失效：

1. 通过 `npm run auth` 更新登录；
2. 检查 `/v1/model-capabilities`；
3. 使用新会话重试请求；
4. 如果问题仍然存在，可能是 DeepSeek 更改了内部 Web API。

---

<p align="center">
  <strong>ForgetMeAI</strong> · <a href="https://t.me/forgetmeai">Telegram</a>
</p>
