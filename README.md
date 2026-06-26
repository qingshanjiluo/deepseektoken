# FreeDeepseekAPI

<p align="center">
  <strong>Local OpenAI-compatible API proxy for DeepSeek Web Chat</strong>
</p>

<p align="center">
  <a href="https://github.com/ForgetMeAI/FreeDeepseekAPI/blob/main/LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green.svg" /></a>
  <img alt="Node.js 18 plus" src="https://img.shields.io/badge/node-18%2B-339933.svg" />
  <img alt="No npm dependencies" src="https://img.shields.io/badge/dependencies-0-blue.svg" />
  <img alt="OpenAI compatible" src="https://img.shields.io/badge/OpenAI-compatible-111111.svg" />
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-example-requests">Examples</a> •
  <a href="#-models">Models</a> •
  <a href="#-endpoints">Endpoints</a> •
  <a href="#-open-webui">Open WebUI</a>
</p>

FreeDeepseekAPI spins up a local API server for **DeepSeek Web Chat** (`chat.deepseek.com`) and lets you connect DeepSeek Web to Open WebUI, LiteLLM, Hermes, Claude Code, OpenAI SDK-style clients, and other OpenAI-compatible tools.

The project works through your normal logged-in DeepSeek account inside a separate Chrome profile. The local server accepts API requests and then talks to DeepSeek Web using the saved browser session.

> ⚠️ This is an experimental web-chat proxy. DeepSeek may change its internal Web API without notice. For production use cases, the official paid DeepSeek API is more reliable.

ForgetMeAI: https://t.me/forgetmeai

---

## Navigation

- [What it gives you](#-what-it-gives-you)
- [Features](#-features)
- [Quick Start](#-quick-start)
- [Windows Setup](#-windows-setup)
- [Linux / Chromium Setup](#-linux--chromium-setup)
- [VPS / Headless Setup](#-vps--headless-setup)
- [Diagnostics / Doctor](#-diagnostics--doctor)
- [Session Reuse and Chat Reset](#-session-reuse-and-chat-reset)
- [Multi-account Pool](#-multi-account-pool)
- [Console Auth Ideas](#-console-auth-ideas)
- [Verification](#-verification)
- [Example Requests](#-example-requests)
  - [Chat Completions](#chat-completions)
  - [Reasoning](#reasoning)
  - [Web Search](#web-search)
  - [Streaming](#streaming)
  - [Anthropic Messages API](#anthropic-messages-api)
  - [OpenAI Responses API](#openai-responses-api)
  - [Tool Calling](#tool-calling)
- [Models](#-models)
- [Endpoints](#-endpoints)
- [Open WebUI](#-open-webui)
- [Refresh Login](#-refresh-login)
- [Project Status](#-project-status)

---

## ✨ What it gives you

- Use DeepSeek Web as a local API endpoint.
- Connect DeepSeek to Open WebUI and other OpenAI-compatible clients.
- Get plain JSON responses or streaming SSE.
- Use reasoning models with separate `reasoning_content`.
- Provide an Anthropic Messages API shim for Claude Code / Anthropic SDK.
- Provide an OpenAI Responses API shim for new OpenAI/Codex‑style clients.
- Keep separate web sessions for different agents/users.

## 🚀 Features

- **OpenAI-compatible API:** `POST /v1/chat/completions`
- **Anthropic-compatible shim:** `POST /v1/messages`
- **OpenAI Responses shim:** `POST /v1/responses`
- **Streaming:** SSE chunks and plain non-stream JSON responses
- **Reasoning output:** separate `reasoning_content` for thinking models
- **Tool calling:** parses OpenAI tools, Anthropic tools, and Responses function tools
- **Model capabilities:** `GET /v1/model-capabilities` with alias → real web mode mapping
- **Agent sessions:** separate DeepSeek session per `user` or agent id
- **Session recovery:** auto-reset of stale chains/sessions
- **Zero dependencies:** Node.js 18+, no npm dependencies

---

## ⚡ Quick Start

```bash
git clone https://github.com/ForgetMeAI/FreeDeepseekAPI.git
cd FreeDeepseekAPI
npm run auth
npm start
```

`npm run auth` opens the authentication menu:

1. choose option `1`;
2. log into DeepSeek in a separate Chrome profile;
3. send a short message like `ok`;
4. return to the terminal and press Enter.

`npm start` shows the launch menu:

- `1` — authenticate / refresh DeepSeek login
- `2` — show models and statuses
- `3` — start the proxy
- `4` — exit

For headless/CI runs without the menu:

```bash
NON_INTERACTIVE=1 npm start
# or
SKIP_ACCOUNT_MENU=1 npm start
```

By default the server listens on:

```text
http://localhost:9655
```

---

## 🪟 Windows Setup

```powershell
git clone https://github.com/ForgetMeAI/FreeDeepseekAPI.git
cd FreeDeepseekAPI
npm run auth
npm start
```

If Chrome is not installed in the standard location, specify the path explicitly:

```powershell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run auth
```

If Chrome is not found, `npm run auth` now prints clear instructions for Windows/macOS/Linux instead of a cryptic stack trace.

---

## 🐧 Linux / Chromium Setup

```bash
git clone https://github.com/ForgetMeAI/FreeDeepseekAPI.git
cd FreeDeepseekAPI
CHROME_PATH=$(which chromium) npm run auth
npm start
```

If Chromium is named differently:

```bash
CHROME_PATH=$(which chromium-browser) npm run auth
# or
CHROME_PATH=$(which google-chrome) npm run auth
```

---

## 🖥 VPS / Headless Setup

The most reliable flow without Chrome on the server:

1. On your local machine with GUI/Chrome, run:

```bash
npm run auth
```

2. Copy `deepseek-auth.json` to the VPS:

```bash
scp deepseek-auth.json user@your-vps:/opt/FreeDeepseekAPI/deepseek-auth.json
```

3. On the VPS, import/validate the file and set safe permissions:

```bash
cd /opt/FreeDeepseekAPI
npm run auth:import -- --input ./deepseek-auth.json
npm run doctor -- --offline
```

4. Start the proxy non-interactively:

```bash
NON_INTERACTIVE=1 npm start
```

You can also import a browser cookie export instead of a ready-made `deepseek-auth.json`:

```bash
DEEPSEEK_TOKEN="<token>" npm run auth:import -- --input ./cookies.json
```

> Important: `deepseek-auth.json` is access to your DeepSeek Web login. Do not commit, do not publish, keep it with `0600` permissions.

---

## 🩺 Diagnostics / Doctor

```bash
npm run doctor
# without network requests to DeepSeek:
npm run doctor -- --offline
```

`doctor` checks:

- whether `deepseek-auth.json` / `DEEPSEEK_AUTH_DIR` is found;
- whether it is valid JSON;
- whether it contains `token`, `cookie`, `wasmUrl`;
- whether file permissions are safe on macOS/Linux (`0600`);
- on normal runs, whether the DeepSeek PoW endpoint is reachable.

If you see `data.biz_data is null`, `fetch failed`, `401/403/429`, or Hermes/OpenCode not seeing models, run `npm run doctor` first.

---

## ♻️ Session Reuse and Chat Reset

FreeDeepseekAPI does not create a new DeepSeek chat for every HTTP request without reason. The logic is:

- one `x-agent-session`, `session`, or `user` → one DeepSeek chat session;
- if the session id already exists, the proxy reuses it and continues the chain via `parent_message_id`;
- auto-reset occurs on TTL, DeepSeek session error, or an overly long message chain;
- local history is kept as a short context so a new DeepSeek session can continue the conversation.

Explicitly set an agent/session:

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-agent-session: my-agent" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'
```

View active sessions:

```bash
curl http://localhost:9655/v1/sessions
```

Reset a single session:

```bash
curl -X POST "http://localhost:9655/reset-session?agent=my-agent"
```

Reset all sessions:

```bash
curl -X POST "http://localhost:9655/reset-session?agent=all"
```

Why chats still appear in DeepSeek Web: the proxy works through the internal Web Chat API, and DeepSeek itself stores real chat sessions on their side. This is normal for a web proxy. Session reuse is meant to avoid creating new chats unnecessarily and to reset only when the chain has gone stale or broken.

---

## 👥 Multi-account Pool

You can connect multiple auth files. The correct model is sticky account per agent/session — the proxy does not switch accounts inside a live DeepSeek session. If an account gets `401/403/429` and goes into cooldown, the session is safely reset and a new request may move to another available account.

Option 1 — a directory with auth files:

```bash
mkdir -p accounts
cp deepseek-auth-main.json accounts/main.json
cp deepseek-auth-backup.json accounts/backup.json
chmod 600 accounts/*.json
DEEPSEEK_AUTH_DIR=./accounts NON_INTERACTIVE=1 npm start
```

Option 2 — a list of files:

```bash
DEEPSEEK_AUTH_PATH="./accounts/main.json,./accounts/backup.json" NON_INTERACTIVE=1 npm start
```

How the pool works:

- a new agent/session gets an available account via round-robin;
- the chosen account is sticky to that session;
- on `401`, `403`, `429` the account goes into cooldown;
- if a session’s sticky account goes into cooldown, the old DeepSeek session is reset to avoid hammering a rate-limited/expired account;
- account status is visible in `/health` without exposing auth file paths or filenames;
- auth files must be kept with `0600` permissions.

Configure cooldown:

```bash
DEEPSEEK_ACCOUNT_COOLDOWN_MS=600000 npm start
```

---

## 🔑 Console Auth Ideas

The password‑based flow from PR #3 can be done, but it is safer not to store the password and not to make it the default. A proper implementation:

1. `npm run auth:console` asks for email/phone and password via hidden prompt.
2. The password stays only in process memory, not written to files/logs/history.
3. The script repeats the Web login flow via `fetch`/CDP: gets captcha/verify challenge, gives the user a link/code, waits for confirmation.
4. After successful login, only the standard `deepseek-auth.json` is saved.
5. If DeepSeek asks for captcha/2FA, the script honestly says “open the link, complete the check, press Enter”, rather than trying to bypass protection.
6. For VPS, the recommended mode is `auth:console --no-save-password --output deepseek-auth.json`.

Minimum secure MVP: console auth is interactive only, without env password. An acceptable automation variant is `DEEPSEEK_EMAIL=... npm run auth:console`, but the password is still entered via hidden prompt.

---

## ✅ Verification

```bash
curl http://localhost:9655/
curl http://localhost:9655/v1/models
curl http://localhost:9655/v1/model-capabilities
```

If all is well, `/health` returns server status, a list of supported aliases, and `config_ready: true`.

---

## 🧪 Example Requests

### Chat Completions

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Hello! Answer with one sentence."}],
    "stream": false
  }'
```

### Reasoning

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "messages": [{"role": "user", "content": "Short answer: why is the sky blue?"}],
    "stream": false
  }'
```

For reasoning models, the API returns the chain of thought separately from the final answer:

- non-stream: `choices[0].message.reasoning_content`
- stream: `choices[0].delta.reasoning_content`
- usage: `usage.completion_tokens_details.reasoning_tokens`

`reasoning_tokens` is an estimate based on the extracted `THINK` text from DeepSeek Web, because the web stream does not report official token usage for reasoning separately.

### Web Search

```bash
curl -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat-search",
    "messages": [{"role": "user", "content": "Find a recent fact about DeepSeek and answer briefly."}],
    "stream": false
  }'
```

### Streaming

```bash
curl -N -X POST http://localhost:9655/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "Tell a short joke."}],
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
    "messages": [{"role": "user", "content": "Reply with exactly OK"}],
    "stream": false
  }'
```

For Claude Code, you can point the backend directly:

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
    "input": "Reply with exactly OK",
    "stream": false
  }'
```

### Tool Calling

FreeDeepseekAPI accepts:

- OpenAI `tools`;
- Anthropic `tools`;
- Responses API function tools.

The proxy asks DeepSeek to return a strict JSON tool call, but also parses fallback formats:

- `TOOL_CALL:`
- fenced JSON
- `<tool_call>...</tool_call>`

---

## 🧠 Models

`GET /v1/models` returns only aliases that are currently verified and working through this proxy.

### Working Aliases

| Alias | Web mode | Reasoning | Web search | Comment |
| --- | --- | --- | --- | --- |
| `deepseek-chat` | `Быстрый` / `default` | no | no | base chat |
| `deepseek-v3` | `Быстрый` / `default` | no | no | compatible alias |
| `deepseek-default` | `Быстрый` / `default` | no | no | compatible alias |
| `deepseek-reasoner` | `Быстрый` / `default` | yes | no | `thinking_enabled=true` |
| `deepseek-r1` | `Быстрый` / `default` | yes | no | R1-compatible alias |
| `deepseek-chat-search` | `Быстрый` / `default` | no | yes | web search |
| `deepseek-default-search` | `Быстрый` / `default` | no | yes | web search alias |
| `deepseek-reasoner-search` | `Быстрый` / `default` | yes | yes | reasoning + search |
| `deepseek-r1-search` | `Быстрый` / `default` | yes | yes | R1-compatible + search |
| `deepseek-expert` | `Эксперт` / `expert` | no | no | Expert mode |
| `deepseek-v4-pro` | `Эксперт` / `expert` | yes | no | Expert + reasoning |

Full mapping:

```bash
curl http://localhost:9655/v1/model-capabilities
```

According to the official DeepSeek V4 Preview page, `deepseek-chat` and `deepseek-reasoner` currently route to `deepseek-v4-flash` (non‑thinking/thinking). In the direct stream from `chat.deepseek.com`, the exact checkpoint name is not returned (`model: ""`), so the proxy records both the web mode (`default` / `Быстрый`) and the actual official routing (`DeepSeek-V4-Flash`).

The current DeepSeek Web remote config shows these web modes:

- `default` / UI `Быстрый` — works; supports `thinking_enabled` and `search_enabled`.
- `expert` / UI `Эксперт` — works through the current web contract (`x-client-version=2.0.0`) and supports `thinking_enabled`. In `/v1/models`, it exposes `deepseek-expert` without reasoning and `deepseek-v4-pro` as Expert + reasoning.
- `vision` / UI `Распознавание` — is visible in remote config, but the direct Web API currently returns `backend_err_by_model` (`Vision is temporarily unavailable`). Therefore `deepseek-vision` is hidden from `/v1/models`.

Search for Expert is not available in remote config, so `deepseek-expert-search` remains unsupported.

---

## 🔌 Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` or `/health` | proxy status |
| `GET` | `/v1/models` | list of working OpenAI-compatible aliases |
| `GET` | `/v1/model-capabilities` | full alias → real model + capabilities mapping |
| `POST` | `/v1/chat/completions` | OpenAI-compatible Chat Completions |
| `POST` | `/v1/messages` | Anthropic Messages API shim |
| `POST` | `/v1/responses` | OpenAI Responses API shim |
| `GET` | `/v1/sessions` | active local agent sessions |
| `POST` | `/reset-session?agent=<id>` | reset a single session |
| `POST` | `/reset-session?agent=all` | reset all sessions |

---

## 🖥 Open WebUI

Base URL for Open WebUI in Docker:

```text
http://host.docker.internal:9655/v1
```

For local non‑Docker runs:

```text
http://localhost:9655/v1
```

The API key can be anything: the proxy talks to DeepSeek Web through the saved browser session.

---

## 🔐 Refresh Login

```bash
npm run auth
npm start
```

If DeepSeek starts returning `401`, `403` or asks for a new PoW/session — rerun `npm run auth` and update the saved browser session.

Local auth files must not end up in GitHub:

- `deepseek-auth.json`
- `.chrome-profile-deepseek/`
- `.env`

They are already added to `.gitignore`.

---

## 🧪 Tests

Syntax check:

```bash
npm test
```

Live smoke tests against a running local proxy:

```bash
BASE_URL=http://127.0.0.1:9655 MODEL=deepseek-chat npm run test:live
```

---

## 📌 Project Status

FreeDeepseekAPI is an experimental web-chat proxy for local use and integrations. It depends on the current contract of DeepSeek Web Chat, so changes on DeepSeek’s side may require updates to the auth/session logic or model mapping.

If something stops working:

1. refresh the login via `npm run auth`;
2. check `/v1/model-capabilities`;
3. retry the request on a fresh session;
4. if the problem persists, DeepSeek has likely changed its internal Web API.

---

<p align="center">
  <strong>ForgetMeAI</strong> · <a href="https://t.me/forgetmeai">Telegram</a>
</p>
