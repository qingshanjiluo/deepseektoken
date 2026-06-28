#!/usr/bin/env node
/**
 * OpenAI 兼容 API 服务器 — DeepSeek Web API 代理
 * 支持流式（SSE）和非流式两种模式
 * 支持工具调用：将工具定义注入系统提示词，
 * 解析 LLM 文本响应中的 TOOL_CALL 模式，返回 OpenAI tool_calls 格式。
 *
 * 每个 `user` 字段拥有独立的 DeepSeek Web 会话。
 * 自动重置：消息链超过 50 条或会话超过 2 小时自动重置。
 * 监听地址：0.0.0.0:9655
 *
 * 增强功能：
 * - 识图模型支持（deepseek-vision），自动上传图片
 * - 提示词注入：通过 x-prompt-injection 请求头或 prompt_injection 参数
 * - 优化的工具调用，支持多格式解析
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const AuthMiddleware = require('./src/auth/authMiddleware');
const { ProxyKeyStore } = require('./src/auth/proxyKeyStore');
const { getProxyDefaults } = require('./src/config/proxy-defaults');

const SERVER_HOST = os.hostname();  // Dynamic hostname detection
const SERVER_PUBLIC_IP = (() => {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) return iface.address;
            }
        }
    } catch (e) {}
    return 'localhost';
})();

const FORGETMEAI_WATERMARK = 't.me/forgetmeai';
const PORT = Number(process.env.PORT || 9655);
const HOST = process.env.HOST || '0.0.0.0';
const proxyDefaults = getProxyDefaults(process.env);

let DEFAULT_INJECTION_PROMPT = proxyDefaults.defaultInjectionPrompt;

// If .injection-prompt.txt exists, use it as the default (wizard-managed)
const WIZARD_INJECTION_FILE = path.join(__dirname, '.injection-prompt.txt');
if (fs.existsSync(WIZARD_INJECTION_FILE)) {
  try {
    const wizardInj = fs.readFileSync(WIZARD_INJECTION_FILE, 'utf8').trim();
    if (wizardInj) {
      DEFAULT_INJECTION_PROMPT = wizardInj;
      console.log(`[DS-API] Using wizard-managed injection prompt (${wizardInj.length} chars)`);
    }
  } catch (e) {}
}
const BOOTSTRAP_INJECTION_ENABLED = proxyDefaults.bootstrapInjectionEnabled;
const PROXY_AUTH_PATH = proxyDefaults.proxyAuthPath;
const PROXY_REQUIRE_AUTH = proxyDefaults.proxyRequireAuth;
function formatWatermark(prefix = 'ForgetMeAI') { return `${prefix}: ${FORGETMEAI_WATERMARK}`; }
function printBanner() {
    console.log(`
 ███████ ██████  ███████ ███████ ██████  ███████ ███████ ███████ ██   ██
 ██      ██   ██ ██      ██      ██   ██ ██      ██      ██      ██  ██
 █████   ██████  █████   █████   ██   ██ █████   █████   █████   █████
 ██      ██   ██ ██      ██      ██   ██ ██      ██      ██      ██  ██
 ██      ██   ██ ███████ ███████ ██████  ███████ ███████ ███████ ██   ██

    FreeDeepseek中文版 — DeepSeek Web Chat API 代理
    ${formatWatermark()}
`);
}
function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}
function isTruthy(value) { return typeof value === 'string' && ['1','true','yes','on'].includes(value.trim().toLowerCase()); }

// === Per-Agent Session Store ===
const sessions = new Map();  // keyed by agent ID (from `user` field)
const MAX_HISTORY_LENGTH = 15;
const MAX_HISTORY_CHARS = 10000;
const MAX_MESSAGE_DEPTH = 100;  // auto-reset after this many messages
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;  // 2 hours

// === DeepSeek Web API Config — loaded from external config file ===
const DS_CONFIG_PATH = process.env.DEEPSEEK_AUTH_PATH || path.join(__dirname, 'deepseek-auth.json');
const DEFAULT_ACCOUNT_COOLDOWN_MS = Number(process.env.DEEPSEEK_ACCOUNT_COOLDOWN_MS || 10 * 60 * 1000);
let DS_CONFIG = {};
let dsHeaders = {};
const accounts = [];
let accountRoundRobin = 0;
const proxyKeyStore = new ProxyKeyStore({ filePath: PROXY_AUTH_PATH });
proxyKeyStore.load();
function buildBaseHeaders(config = DS_CONFIG) {
    return {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "x-client-platform": "web",
        "x-client-version": "2.0.0",
        "x-client-locale": "ru",
        "x-client-timezone-offset": "14400",
        "x-app-version": "2.0.0",
        "Authorization": `Bearer ${config.token || ''}`,
        "x-hif-dliq": config.hif_dliq || '',
        "x-hif-leim": config.hif_leim || '',
        "Origin": "https://chat.deepseek.com",
        "Referer": "https://chat.deepseek.com/",
        "Cookie": config.cookie || '',
        "Content-Type": "application/json",
    };
}
function discoverAuthPaths() {
    if (process.env.DEEPSEEK_AUTH_DIR) {
        try {
            return fs.readdirSync(process.env.DEEPSEEK_AUTH_DIR)
                .filter(f => f.endsWith('.json'))
                .sort()
                .map(f => path.join(process.env.DEEPSEEK_AUTH_DIR, f));
        } catch (e) {
            console.error(`[DS-API] 无法读取 DEEPSEEK_AUTH_DIR: ${e.message}`);
            return [];
        }
    }
    if (process.env.DEEPSEEK_AUTH_PATH && process.env.DEEPSEEK_AUTH_PATH.includes(',')) {
        return process.env.DEEPSEEK_AUTH_PATH.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [DS_CONFIG_PATH];
}
function loadDeepSeekConfig({ fatal = true } = {}) {
    accounts.length = 0;
    const paths = discoverAuthPaths();
    for (const file of paths) {
        try {
            const raw = fs.readFileSync(file, 'utf8');
            const config = JSON.parse(raw);
            const id = `account_${accounts.length + 1}`;
            accounts.push({ id, file, config, headers: buildBaseHeaders(config), cooldownUntil: 0, failures: 0, lastUsedAt: 0 });
        } catch (e) {
            console.error(`[DS-API] 无法加载认证配置 ${file}: ${e.message}`);
        }
    }
    DS_CONFIG = accounts[0]?.config || {};
    dsHeaders = accounts[0]?.headers || buildBaseHeaders({});
    if (accounts.length > 0) {
        console.log(`[DS-API] 已加载 ${accounts.length} 个认证账号: ${accounts.map(a => a.id).join(', ')}`);
        return true;
    }
    if (fatal) {
        console.error(`[DS-API] 致命错误: 无法加载任何认证配置。期望路径: ${paths.join(', ') || DS_CONFIG_PATH}`);
        process.exit(1);
    }
    return false;
}
function hasAuthConfig() { return accounts.some(a => a.config.token && a.config.cookie); }
function accountStatus(account) {
    return {
        id: account.id,
        ready: !!(account.config.token && account.config.cookie),
        cooldown: account.cooldownUntil > Date.now(),
        cooldown_remaining_sec: Math.max(0, Math.ceil((account.cooldownUntil - Date.now()) / 1000)),
        failures: account.failures,
        last_used_at: account.lastUsedAt || null,
    };
}
function selectAccountForSession(session) {
    const now = Date.now();
    if (session.accountId) {
        const sticky = accounts.find(a => a.id === session.accountId);
        if (sticky && sticky.config.token && sticky.config.cookie && sticky.cooldownUntil <= now) return sticky;
        if (sticky && sticky.cooldownUntil > now) {
            // A DeepSeek chat_session belongs to the auth account that created it.
            // If that account is rate-limited/expired, do not keep hammering it;
            // reset the web session and let a healthy account take over.
            resetWebSession(session);
        }
        session.accountId = null;
    }
    const ready = accounts.filter(a => a.config.token && a.config.cookie && a.cooldownUntil <= now);
    if (ready.length === 0) {
        const waiting = accounts.filter(a => a.config.token && a.config.cookie).sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0];
        if (waiting) {
            const waitSec = Math.max(1, Math.ceil((waiting.cooldownUntil - now) / 1000));
            throw new Error(`All DeepSeek auth accounts are cooling down. Retry in ~${waitSec}s or import a fresh account with npm run auth:import.`);
        }
        throw new Error('No valid DeepSeek auth accounts. Run npm run auth or npm run auth:import.');
    }
    const account = ready[accountRoundRobin % ready.length];
    accountRoundRobin++;
    session.accountId = account.id;
    return account;
}
// Parse a Retry-After header value into a cooldown duration in ms, or null if
// absent/unparseable. Supports both forms: delta-seconds (e.g. "120") and an
// HTTP-date (e.g. "Wed, 21 Oct 2025 07:28:00 GMT"). Clamped to >= 1s.
function parseRetryAfterMs(retryAfterRaw) {
    if (!retryAfterRaw) return null;
    const raw = String(retryAfterRaw).trim();
    if (/^\d+$/.test(raw)) return Math.max(1000, Number(raw) * 1000);
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return Math.max(1000, t - Date.now());
    return null;
}
function markAccountFailure(account, status, reason = '', retryAfterRaw = null) {
    if (!account) return;
    account.failures++;
    if ([401, 403, 429].includes(Number(status))) {
        // On 429, honor a valid Retry-After header (seconds or HTTP-date) when present;
        // otherwise fall back to the fixed env-configured cooldown.
        const retryMs = Number(status) === 429 ? parseRetryAfterMs(retryAfterRaw) : null;
        const cooldownMs = retryMs != null ? retryMs : DEFAULT_ACCOUNT_COOLDOWN_MS;
        account.cooldownUntil = Date.now() + cooldownMs;
        console.log(`[account:${account.id}] 冷却 ${Math.round(cooldownMs / 1000)}s，HTTP ${status} 后${reason ? ` (${reason})` : ''}${retryMs != null ? ' (Retry-After)' : ''}`);
    }
}
async function readDeepSeekJsonResponse(resp, label, account) {
    const text = await resp.text();
    let json = null;
    if (text) {
        try { json = JSON.parse(text); }
        catch (e) {
            markAccountFailure(account, resp.status, label);
            throw new Error(`DeepSeek returned non-JSON ${label} response (HTTP ${resp.status}). Run npm run doctor. First chars: ${text.substring(0, 120)}`);
        }
    }
    if (!resp.ok) markAccountFailure(account, resp.status, label);
    return { json, text };
}

if (require.main === module) {
    loadDeepSeekConfig({ fatal: false });
}

function createSession() {
    return {
        id: null,
        parentMessageId: null,
        createdAt: null,
        messageCount: 0,
        accountId: null,
        bootstrapInjected: false,
        bootstrapInjectedAt: null,
        lastResponseMessageId: null,
        lastFinishReason: null,
        history: [],
    };
}

function resetWebSession(session) {
    session.id = null;
    session.parentMessageId = null;
    session.createdAt = null;
    session.messageCount = 0;
    session.bootstrapInjected = false;
    session.bootstrapInjectedAt = null;
    session.lastResponseMessageId = null;
    session.lastFinishReason = null;
}

function shouldBootstrapSession(session) {
    return !!(session && session.id && !session.bootstrapInjected && Number(session.messageCount || 0) === 0);
}

async function performBootstrapInjection(session, agentId, model, agentTag) {
    if (!shouldBootstrapSession(session)) return;
    if (!BOOTSTRAP_INJECTION_ENABLED) return;

    const bootstrapPrompt = DEFAULT_INJECTION_PROMPT;
    const account = selectAccountForSession(session);
    const modelCfg = resolveModelConfig(model);

    console.log(`${agentTag} 开始 bootstrap 注入（隐藏预热）`);
    try {
        const { resp } = await askDeepSeekStream(bootstrapPrompt, agentId, model, []);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;
        let bootstrapMessageId = null;

        while (!done) {
            const chunk = await reader.read();
            done = chunk.done;
            if (chunk.value) {
                buffer += decoder.decode(chunk.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const d = JSON.parse(line.slice(6));
                            if (d.response_message_id !== undefined && !bootstrapMessageId) {
                                bootstrapMessageId = d.response_message_id;
                            }
                            if (d.v && typeof d.v === 'object' && d.v.response && d.v.response.message_id !== undefined) {
                                bootstrapMessageId = d.v.response.message_id;
                            }
                        } catch (e) {}
                    }
                }
            }
        }

        if (bootstrapMessageId) {
            session.parentMessageId = bootstrapMessageId;
            session.bootstrapInjected = true;
            session.bootstrapInjectedAt = Date.now();
            session.messageCount = 0;
            console.log(`${agentTag} bootstrap 注入完成（message_id: ${bootstrapMessageId}）`);
        } else {
            console.log(`${agentTag} bootstrap 未获取到 message_id，跳过`);
        }
    } catch (e) {
        console.log(`${agentTag} bootstrap 注入失败（非致命）: ${e.message}`);
    }
}

function buildContinuePayload(chatSessionId, messageId) {
    return {
        chat_session_id: chatSessionId,
        message_id: messageId,
        fallback_to_resume: true,
    };
}

function getOrCreateAgentSession(agentId) {
    if (!sessions.has(agentId)) {
        sessions.set(agentId, createSession());
    }
    return sessions.get(agentId);
}

async function solvePOW(challenge, config = DS_CONFIG) {
    const resp = await fetch(config.wasmUrl);
    const wasmBytes = await resp.arrayBuffer();
    const mod = await WebAssembly.instantiate(wasmBytes, { wbg: {} });
    const e = mod.instance.exports;
    const encoder = new TextEncoder();
    const prefix = challenge.salt + '_' + challenge.expire_at + '_';
    const cBytes = encoder.encode(challenge.challenge);
    const pBytes = encoder.encode(prefix);
    const cP = e.__wbindgen_export_0(cBytes.length, 1) >>> 0;
    const pP = e.__wbindgen_export_0(pBytes.length, 1) >>> 0;
    new Uint8Array(e.memory.buffer, cP, cBytes.length).set(cBytes);
    new Uint8Array(e.memory.buffer, pP, pBytes.length).set(pBytes);
    const sp = e.__wbindgen_add_to_stack_pointer(-16);
    e.wasm_solve(sp, cP, cBytes.length, pP, pBytes.length, challenge.difficulty);
    const dv = new DataView(e.memory.buffer);
    const code = dv.getInt32(sp, true);
    const ans = dv.getFloat64(sp + 8, true);
    e.__wbindgen_add_to_stack_pointer(16);
    if (code === 0 || !Number.isFinite(ans) || ans <= 0) throw new Error('POW failed');
    return Math.floor(ans);
}

async function callDeepSeekContinue(session, account, agentTag) {
    if (!session.id || !session.lastResponseMessageId) {
        console.log(`${agentTag} 无法继续：缺少 session.id 或 responseMessageId`);
        return null;
    }
    const dsHeaders = account.headers;
    const payload = buildContinuePayload(session.id, session.lastResponseMessageId);

    const cr = await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', {
        method: 'POST', headers: dsHeaders,
        body: JSON.stringify({ target_path: '/api/v0/chat/continue' })
    });
    const chalText = await cr.text();
    if (!cr.ok) {
        console.log(`${agentTag} continue PoW 挑战失败: HTTP ${cr.status}`);
        return null;
    }
    let chalJson;
    try { chalJson = JSON.parse(chalText); } catch (e) {
        console.log(`${agentTag} continue PoW 响应非 JSON`);
        return null;
    }
    const challenge = chalJson?.data?.biz_data?.challenge;
    if (!challenge) {
        console.log(`${agentTag} continue PoW 无 challenge`);
        return null;
    }
    const answer = await solvePOW(challenge, account.config);
    const powB64 = Buffer.from(JSON.stringify({
        algorithm: challenge.algorithm, challenge: challenge.challenge,
        salt: challenge.salt, answer: answer,
        signature: challenge.signature, target_path: '/api/v0/chat/continue'
    })).toString('base64');

    console.log(`${agentTag} 调用真实 continue（session: ${session.id}, msg: ${session.lastResponseMessageId}）`);
    const resp = await fetch('https://chat.deepseek.com/api/v0/chat/continue', {
        method: 'POST',
        headers: { ...dsHeaders, 'X-DS-PoW-Response': powB64 },
        body: JSON.stringify(payload),
    });
    if (resp.status !== 200) {
        console.log(`${agentTag} continue 失败: HTTP ${resp.status}`);
        return null;
    }
    return resp;
}

async function callDeepSeekEditMessage(session, account, prompt, modelCfg) {
    if (!session.id || !session.lastResponseMessageId) return null;
    const dsHeaders = account.headers;
    const cr = await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', {
        method: 'POST', headers: dsHeaders,
        body: JSON.stringify({ target_path: '/api/v0/chat/edit_message' })
    });
    const chalText = await cr.text();
    if (!cr.ok) return null;
    let chalJson;
    try { chalJson = JSON.parse(chalText); } catch (e) { return null; }
    const challenge = chalJson?.data?.biz_data?.challenge;
    if (!challenge) return null;
    const answer = await solvePOW(challenge, account.config);
    const powB64 = Buffer.from(JSON.stringify({
        algorithm: challenge.algorithm, challenge: challenge.challenge,
        salt: challenge.salt, answer, signature: challenge.signature,
        target_path: '/api/v0/chat/edit_message'
    })).toString('base64');

    const resp = await fetch('https://chat.deepseek.com/api/v0/chat/edit_message', {
        method: 'POST',
        headers: { ...dsHeaders, 'X-DS-PoW-Response': powB64 },
        body: JSON.stringify({
            chat_session_id: session.id,
            message_id: session.lastResponseMessageId,
            prompt,
            thinking_enabled: modelCfg.thinking_enabled,
            search_enabled: modelCfg.search_enabled,
        }),
    });
    if (resp.status !== 200) return null;
    return resp;
}

// === Vision Model Support: File Upload ===
// Uploads an image file to DeepSeek's file API and returns the file_id.
// Requires its own PoW challenge with target_path: /api/v0/file/upload_file
async function uploadFile(imageBuffer, fileName, mimeType, account, modelCfg) {
    const dsHeaders = account.headers;
    const agentTag = `[upload]`;

    // Step 1: Create PoW challenge for file upload
    const cr = await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', {
        method: 'POST', headers: dsHeaders,
        body: JSON.stringify({ target_path: '/api/v0/file/upload_file' })
    });
    const chalText = await cr.text();
    if (!cr.ok) {
        throw new Error(`File upload PoW challenge failed: HTTP ${cr.status}`);
    }
    let chalJson;
    try { chalJson = JSON.parse(chalText); } catch (e) {
        throw new Error(`File upload PoW non-JSON response: ${chalText.substring(0, 120)}`);
    }
    const challenge = chalJson?.data?.biz_data?.challenge;
    if (!challenge) {
        throw new Error('File upload PoW response has no data.biz_data.challenge');
    }
    const answer = await solvePOW(challenge, account.config);

    const powB64 = Buffer.from(JSON.stringify({
        algorithm: challenge.algorithm, challenge: challenge.challenge,
        salt: challenge.salt, answer: answer,
        signature: challenge.signature, target_path: '/api/v0/file/upload_file'
    })).toString('base64');

    // Step 2: Build multipart/form-data for file upload
    // Use WebKit-style boundary format matching the real DeepSeek client
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const headerPart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footerPart = `\r\n--${boundary}--\r\n`;
    const headerBuf = Buffer.from(headerPart, 'utf8');
    const footerBuf = Buffer.from(footerPart, 'utf8');
    const bodyBuf = Buffer.concat([headerBuf, imageBuffer, footerBuf]);

    // Build upload headers matching the real DeepSeek web client format
    const uploadHeaders = {
        ...dsHeaders,
        'X-DS-PoW-Response': powB64,
        'x-model-type': modelCfg.model_type || 'vision',
        'x-thinking-enabled': modelCfg.thinking_enabled ? '1' : '0',
        'x-file-size': String(imageBuffer.length),
        'x-client-bundle-id': dsHeaders['x-client-bundle-id'] || 'com.deepseek.chat',
        'x-client-locale': dsHeaders['x-client-locale'] || 'zh_CN',
        'x-client-timezone-offset': dsHeaders['x-client-timezone-offset'] || '28800',
        'x-app-version': dsHeaders['x-app-version'] || '2.0.0',
        'x-client-version': dsHeaders['x-client-version'] || '2.0.0',
        'x-client-platform': dsHeaders['x-client-platform'] || 'web',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };

    const uploadResp = await fetch('https://chat.deepseek.com/api/v0/file/upload_file', {
        method: 'POST',
        headers: uploadHeaders,
        body: bodyBuf,
    });

    const uploadText = await uploadResp.text();
    if (!uploadResp.ok) {
        throw new Error(`File upload failed: HTTP ${uploadResp.status} - ${uploadText.substring(0, 200)}`);
    }

    let uploadJson;
    try { uploadJson = JSON.parse(uploadText); } catch (e) {
        throw new Error(`File upload non-JSON response: ${uploadText.substring(0, 120)}`);
    }

    // Extract file_id from response - try multiple possible paths
    const fileId = uploadJson?.data?.biz_data?.id
        || uploadJson?.data?.biz_data?.file_id
        || uploadJson?.data?.id
        || uploadJson?.id;

    if (!fileId) {
        throw new Error(`Could not extract file_id from upload response: ${uploadText.substring(0, 200)}`);
    }

    console.log(`${agentTag} 已上传 ${fileName} (${imageBuffer.length} 字节) -> file_id: ${fileId}`);
    return fileId;
}

// Extract image data from messages and upload them
// Returns an array of ref_file_ids
async function processImageMessages(messages, account, modelCfg) {
    const refFileIds = [];
    if (!messages || !Array.isArray(messages)) return refFileIds;

    for (const msg of messages) {
        if (!msg.content) continue;
        const parts = Array.isArray(msg.content) ? msg.content : [msg.content];

        for (const part of parts) {
            if (part && typeof part === 'object' && part.type === 'image_url') {
                const url = part.image_url?.url || '';
                if (!url) continue;

                try {
                    let imageBuffer;
                    let fileName = 'image.jpg';
                    let mimeType = 'image/jpeg';

                    if (url.startsWith('data:')) {
                        // Handle base64 data URL
                        const matches = url.match(/^data:([^;]+);base64,(.+)$/);
                        if (!matches) {
                            console.log(`[upload] 无效的 data URL 格式，跳过`);
                            continue;
                        }
                        mimeType = matches[1];
                        imageBuffer = Buffer.from(matches[2], 'base64');
                        // Determine file extension from mime type
                        const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
                        fileName = `image.${extMap[mimeType] || 'jpg'}`;
                    } else if (url.startsWith('http://') || url.startsWith('https://')) {
                        // Download from URL
                        console.log(`[upload] 正在从 URL 下载图片: ${url.substring(0, 80)}...`);
                        const imgResp = await fetch(url);
                        if (!imgResp.ok) {
                            console.log(`[upload] 下载图片失败: HTTP ${imgResp.status}`);
                            continue;
                        }
                        imageBuffer = Buffer.from(await imgResp.arrayBuffer());
                        mimeType = imgResp.headers.get('content-type') || 'image/jpeg';
                        const urlExt = url.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
                        fileName = `image.${urlExt}`;
                    } else if (url.startsWith('file://') || url.startsWith('/') || url.match(/^[A-Za-z]:\\/)) {
                        // Local file path
                        const filePath = url.startsWith('file://') ? url.slice(7) : url;
                        console.log(`[upload] 正在读取本地文件: ${filePath}`);
                        if (fs.existsSync(filePath)) {
                            imageBuffer = fs.readFileSync(filePath);
                            const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'jpg';
                            const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
                            mimeType = mimeMap[ext] || 'image/jpeg';
                            fileName = path.basename(filePath);
                        } else {
                            console.log(`[upload] 本地文件未找到: ${filePath}`);
                            continue;
                        }
                    } else {
                        console.log(`[upload] 不支持的图片 URL 格式，跳过: ${url.substring(0, 60)}`);
                        continue;
                    }

                    // Upload the image
                    const fileId = await uploadFile(imageBuffer, fileName, mimeType, account, modelCfg);
                    refFileIds.push(fileId);
                } catch (e) {
                    console.log(`[upload] 处理图片出错: ${e.message}`);
                }
            }
        }
    }

    return refFileIds;
}

const MODEL_CONFIGS = {
    // DeepSeek Web real model_type: default / UI name: "Быстрый".
    // Public model family: DeepSeek-V3.2-Exp chat mode (fast, no visible reasoning).
    'deepseek-chat': {
        model_type: 'default', thinking_enabled: false, search_enabled: false,
        real_model: 'DeepSeek-V4-Flash non-thinking (DeepSeek Web “Быстрый” / default)',
        capabilities: { reasoning: false, web_search: false, files: true },
        supported: true,
    },
    'deepseek-v3': {
        model_type: 'default', thinking_enabled: false, search_enabled: false,
        real_model: 'DeepSeek-V4-Flash non-thinking (DeepSeek Web “Быстрый” / default)',
        capabilities: { reasoning: false, web_search: false, files: true },
        supported: true,
    },
    'deepseek-default': {
        model_type: 'default', thinking_enabled: false, search_enabled: false,
        real_model: 'DeepSeek-V4-Flash non-thinking (DeepSeek Web “Быстрый” / default)',
        capabilities: { reasoning: false, web_search: false, files: true },
        supported: true,
    },
    // Same DeepSeek Web default model, but with thinking_enabled=true. UI exposes it as thinking/reasoning mode.
    'deepseek-reasoner': {
        model_type: 'default', thinking_enabled: true, search_enabled: false,
        real_model: 'DeepSeek-V4-Flash thinking mode (DeepSeek Web “Быстрый” + thinking_enabled)',
        capabilities: { reasoning: true, web_search: false, files: true },
        supported: true,
    },
    'deepseek-r1': {
        model_type: 'default', thinking_enabled: true, search_enabled: false,
        real_model: 'DeepSeek-V4-Flash thinking mode; R1-compatible alias, not a separate R1 model_type in current Web API',
        capabilities: { reasoning: true, web_search: false, files: true },
        supported: true,
    },
    'deepseek-chat-search': {
        model_type: 'default', thinking_enabled: false, search_enabled: true,
        real_model: 'DeepSeek-V4-Flash non-thinking (DeepSeek Web “Быстрый” / default) + web search',
        capabilities: { reasoning: false, web_search: true, files: true },
        supported: true,
    },
    'deepseek-default-search': {
        model_type: 'default', thinking_enabled: false, search_enabled: true,
        real_model: 'DeepSeek-V4-Flash non-thinking (DeepSeek Web “Быстрый” / default) + web search',
        capabilities: { reasoning: false, web_search: true, files: true },
        supported: true,
    },
    'deepseek-reasoner-search': {
        model_type: 'default', thinking_enabled: true, search_enabled: true,
        real_model: 'DeepSeek-V4-Flash thinking mode + web search',
        capabilities: { reasoning: true, web_search: true, files: true },
        supported: true,
    },
    'deepseek-r1-search': {
        model_type: 'default', thinking_enabled: true, search_enabled: true,
        real_model: 'DeepSeek-V4-Flash thinking mode + web search; R1-compatible alias',
        capabilities: { reasoning: true, web_search: true, files: true },
        supported: true,
    },
    // DeepSeek Web UI name: “Эксперт”. Requires current web client headers (x-client-version=2.0.0).
    'deepseek-expert': {
        model_type: 'expert', thinking_enabled: false, search_enabled: false,
        real_model: 'DeepSeek Web “Эксперт” (limited resources)',
        capabilities: { reasoning: false, web_search: false, files: false },
        supported: true,
    },
    'deepseek-v4-pro': {
        model_type: 'expert', thinking_enabled: true, search_enabled: false,
        real_model: 'DeepSeek Web “Эксперт” + thinking mode (exposed as deepseek-v4-pro alias)',
        capabilities: { reasoning: true, web_search: false, files: false },
        supported: true,
    },
    'deepseek-expert-search': {
        model_type: 'expert', thinking_enabled: false, search_enabled: true,
        real_model: 'DeepSeek Web “Эксперт” + search requested, but Expert has search_feature=null in remote config',
        capabilities: { reasoning: false, web_search: false, files: false },
        supported: false,
        unavailable_reason: 'Expert mode is rejected; remote config says search is not available for Expert.',
    },
    'deepseek-vision': {
        model_type: 'vision', thinking_enabled: false, search_enabled: false,
        real_model: 'DeepSeek Web "Распознавание" / image understanding beta',
        capabilities: { reasoning: false, web_search: false, files: true, vision: true },
        supported: true,
    },
    'deepseek-vision-thinking': {
        model_type: 'vision', thinking_enabled: true, search_enabled: false,
        real_model: 'DeepSeek Web "Распознавание" / image understanding beta (thinking mode)',
        capabilities: { reasoning: true, web_search: false, files: true, vision: true },
        supported: true,
    },
};

const SUPPORTED_MODEL_IDS = Object.keys(MODEL_CONFIGS).filter(id => MODEL_CONFIGS[id].supported);
const ALL_MODEL_CAPABILITIES = Object.fromEntries(Object.entries(MODEL_CONFIGS).map(([id, cfg]) => [id, {
    id,
    real_model: cfg.real_model,
    model_type: cfg.model_type,
    thinking_enabled: cfg.thinking_enabled,
    search_enabled: cfg.search_enabled,
    capabilities: cfg.capabilities,
    supported: cfg.supported,
    unavailable_reason: cfg.unavailable_reason || null,
}]));

function isAssistantOutputFragment(fragment) {
    return fragment
        && (fragment.type === 'RESPONSE' || fragment.type === 'SEARCH')
        && typeof fragment.content === 'string';
}

function isReasoningFragment(fragment) {
    return fragment
        && (fragment.type === 'THINK' || fragment.type === 'REASONING')
        && typeof fragment.content === 'string';
}

function isDeepSeekModelErrorEvent(event) {
    return event && event.type === 'error';
}

function rebuildFragmentText(fragments) {
    const responseText = fragments
        .filter(isAssistantOutputFragment)
        .map(f => f.content)
        .join('');
    const thinkText = fragments
        .filter(isReasoningFragment)
        .map(f => f.content)
        .join('');
    return { responseText, thinkText };
}

function applyResponsePatchOperations(ops, appendFragments) {
    if (!Array.isArray(ops)) return false;
    let applied = false;
    for (const op of ops) {
        if (!op || typeof op !== 'object') continue;
        if (op.p === 'fragments' && op.o === 'APPEND' && op.v !== undefined) {
            appendFragments(op.v);
            applied = true;
        }
    }
    return applied;
}

function resolveModelConfig(model) {
    const requested = String(model || 'deepseek-chat').toLowerCase();
    return MODEL_CONFIGS[requested] || MODEL_CONFIGS['deepseek-chat'];
}
function isKnownModel(model) { return Object.prototype.hasOwnProperty.call(MODEL_CONFIGS, String(model || '').toLowerCase()); }
function isSupportedModel(model) { return resolveModelConfig(model).supported === true; }

async function askDeepSeekStream(prompt, agentId, model = 'deepseek-default', refFileIds = []) {
    const modelCfg = resolveModelConfig(model);
    const session = getOrCreateAgentSession(agentId);
    const account = selectAccountForSession(session);
    const dsHeaders = account.headers;
    account.lastUsedAt = Date.now();
    const agentTag = `[${agentId}/acct:${account.id}]`;

    // Auto-reset on deep message chain
    if (session.id && session.messageCount >= MAX_MESSAGE_DEPTH) {
        console.log(`${agentTag} 会话 ${session.id} 已达 ${session.messageCount} 条消息，自动重置`);
        resetWebSession(session);
        // History preserved for context injection
    }

    // Reset expired sessions (DeepSeek web sessions last ~1-2 hours)
    if (session.id && session.createdAt && (Date.now() - session.createdAt > SESSION_TTL_MS)) {
        console.log(`${agentTag} 会话 ${session.id} 已过期（时长: ${Math.round((Date.now() - session.createdAt) / 60000)}分钟），正在创建新会话...`);
        resetWebSession(session);
    }

    const cr = await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', {
        method: 'POST', headers: dsHeaders,
        body: JSON.stringify({ target_path: '/api/v0/chat/completion' })
    });
    const chalText = await cr.text();
    if (!cr.ok) {
        markAccountFailure(account, cr.status, 'pow challenge');
        throw new Error(`DeepSeek auth/network error while creating PoW challenge: HTTP ${cr.status}. Run npm run doctor. If auth expired, run npm run auth or npm run auth:import.`);
    }
    let chalJson;
    try { chalJson = JSON.parse(chalText); }
    catch (e) { throw new Error(`DeepSeek returned non-JSON PoW response. Run npm run doctor. First chars: ${chalText.substring(0, 120)}`); }
    const challenge = chalJson?.data?.biz_data?.challenge;
    if (!challenge) {
        throw new Error('DeepSeek PoW response has no data.biz_data.challenge. Auth may be expired, captcha may be required, or DeepSeek changed Web API. Run npm run doctor, then npm run auth.');
    }
    const answer = await solvePOW(challenge, account.config);

    if (!session.id) {
        const sr = await fetch('https://chat.deepseek.com/api/v0/chat_session/create', {
            method: 'POST', headers: dsHeaders, body: '{}'
        });
        const { json: sessionData, text: sessionText } = await readDeepSeekJsonResponse(sr, 'session create', account);
        const createdSessionId = sessionData?.data?.biz_data?.chat_session?.id || sessionData?.data?.biz_data?.id;
        if (!sr.ok || !createdSessionId) {
            throw new Error(`Could not create DeepSeek chat session (HTTP ${sr.status}). Auth may be expired/captcha-blocked. Run npm run doctor, then npm run auth. First chars: ${String(sessionText || '').substring(0, 120)}`);
        }
        session.id = createdSessionId;
        session.accountId = account.id;
        session.parentMessageId = null;
        session.createdAt = Date.now();
        session.messageCount = 0;
        console.log(`${agentTag} 已创建新会话: ${session.id}`);
    } else {
        console.log(`${agentTag} 复用会话: ${session.id}（父消息: ${session.parentMessageId}, 消息#${session.messageCount}）`);
    }

    const powB64 = Buffer.from(JSON.stringify({
        algorithm: challenge.algorithm, challenge: challenge.challenge,
        salt: challenge.salt, answer: answer,
        signature: challenge.signature, target_path: '/api/v0/chat/completion'
    })).toString('base64');
    // When images are attached, DeepSeek requires model_type to be "vision"
    const effectiveModelType = (refFileIds && refFileIds.length > 0) ? 'vision' : modelCfg.model_type;

    const resp = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
        headers: { ...dsHeaders, 'X-DS-PoW-Response': powB64 },
        body: JSON.stringify({
            chat_session_id: session.id,
            parent_message_id: session.parentMessageId,
            model_type: effectiveModelType,
            prompt: prompt, ref_file_ids: refFileIds,
            thinking_enabled: modelCfg.thinking_enabled, search_enabled: modelCfg.search_enabled,
            action: null, preempt: false,
        })
    });

    // If session expired, reset and retry once
    if (resp.status !== 200) {
        // Pass Retry-After so a 429 honors the server-requested cooldown (#16).
        markAccountFailure(account, resp.status, 'completion', resp.headers.get('retry-after'));
        const errText = await resp.text();
        console.log(`${agentTag} 会话错误 (${resp.status}): ${errText.substring(0, 100)}`);
        if (resp.status === 400 || resp.status === 404 || resp.status === 500) {
            console.log(`${agentTag} 会话 ${session.id} 已过期，正在创建新会话...`);
            resetWebSession(session);

            const sr2 = await fetch('https://chat.deepseek.com/api/v0/chat_session/create', {
                method: 'POST', headers: dsHeaders, body: '{}'
            });
            const { json: sessionData2, text: sessionText2 } = await readDeepSeekJsonResponse(sr2, 'session recreate', account);
            const createdSessionId2 = sessionData2?.data?.biz_data?.chat_session?.id || sessionData2?.data?.biz_data?.id;
            if (!sr2.ok || !createdSessionId2) {
                throw new Error(`Could not recreate DeepSeek chat session (HTTP ${sr2.status}). Run npm run doctor, then npm run auth. First chars: ${String(sessionText2 || '').substring(0, 120)}`);
            }
            session.id = createdSessionId2;
            session.accountId = account.id;
            session.parentMessageId = null;
            session.createdAt = Date.now();
            console.log(`${agentTag} 已创建新会话: ${session.id}`);

            const newPowB64 = Buffer.from(JSON.stringify({
                algorithm: challenge.algorithm, challenge: challenge.challenge,
                salt: challenge.salt, answer: answer,
                signature: challenge.signature, target_path: '/api/v0/chat/completion'
            })).toString('base64');
            const resp2 = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
                method: 'POST',
                headers: { ...dsHeaders, 'X-DS-PoW-Response': newPowB64 },
                body: JSON.stringify({
                    chat_session_id: session.id,
                    parent_message_id: null,
                    model_type: effectiveModelType,
                    prompt: prompt, ref_file_ids: refFileIds,
                    thinking_enabled: modelCfg.thinking_enabled, search_enabled: modelCfg.search_enabled,
                    action: null, preempt: false,
                })
            });
            return { resp: resp2, agentId, account };
        }
    }

    return { resp, agentId, account };
}

// === Tool Calling Support ===

function formatToolDefinitions(tools) {
    if (!tools || tools.length === 0) return '';
    let text = '\n\n--- TOOL REQUEST SYSTEM ---\n';
    text += 'You are an AI assistant that has access to tools. When you need to use a tool, you MUST output ONLY the tool request with NO additional text, explanation, or commentary.\n';
    text += '\n';
    text += '## CRITICAL: Output Format\n';
    text += 'You MUST output tool requests in EXACTLY one of these formats (PREFER the first):\n';
    text += '\n';
    text += 'Format 1 (PREFERRED - strict JSON):\n';
    text += '{"tool_call":{"name":"<function_name>","arguments":{...}}}\n';
    text += '\n';
    text += 'Format 2 (legacy):\n';
    text += 'TOOL_CALL: <function_name>\n';
    text += 'arguments: <JSON arguments>\n';
    text += '\n';
    text += 'Format 3 (XML wrapper):\n';
    text += '<tool_call>\n';
    text += '{"name":"<function_name>","arguments":{...}}\n';
    text += '</tool_call>\n';
    text += '\n';
    text += '## RULES (MUST FOLLOW):\n';
    text += '1. CRITICAL: Call ONLY ONE tool at a time. Never output more than one tool call in a single response.\n';
    text += '2. When you need data, output ONLY the tool request — NO explanations, NO thinking, NO extra text before or after.\n';
    text += '3. Do NOT simulate, guess, or fabricate command output — wait for the actual result.\n';
    text += '4. The tool runs on ' + SERVER_HOST + ' (' + SERVER_PUBLIC_IP + '), the local server — NOT on DeepSeek.\n';
    text += '5. After the tool executes, the result will be sent to you as a new user/tool message.\n';
    text += '6. Keep arguments compact and minimal. Do not include large file contents.\n';
    text += '7. NEVER wrap tool calls in markdown code blocks or any other formatting.\n';
    text += '8. Use ONLY the exact JSON format shown above. Any deviation will cause the tool to fail.\n';
    text += '\n';
    text += '## Available Functions:\n';
    for (const tool of tools) {
        if (tool.type === 'function' && tool.function) {
            const fn = tool.function;
            text += `\n### ${fn.name}\n`;
            text += `${fn.description || 'No description'}\n`;
            if (fn.parameters) {
                const paramStr = JSON.stringify(fn.parameters);
                // Truncate very large parameter schemas to avoid hitting token limits
                text += `Parameters: ${paramStr.length > 2000 ? paramStr.substring(0, 2000) + '...(truncated)' : paramStr}\n`;
            }
        }
    }
    text += '\n--- END TOOL REQUEST SYSTEM ---\n';
    text += '\nREMEMBER: Output ONLY the tool request when you need to use a tool. No extra text.';
    return text;
}

function extractBalancedJsonAt(text, startIndex) {
    let braceDepth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIndex; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (!inString) {
            if (ch === '{') braceDepth++;
            if (ch === '}') {
                braceDepth--;
                if (braceDepth === 0) return text.substring(startIndex, i + 1);
            }
        }
    }
    return null;
}

function coerceToolCallObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const candidate = obj.tool_call || obj.tool || obj.function_call || obj;
    if (!candidate || typeof candidate !== 'object') return null;
    const fn = candidate.function && typeof candidate.function === 'object' ? candidate.function : candidate;
    const name = fn.name || candidate.name || obj.name;
    let args = fn.arguments ?? candidate.arguments ?? candidate.input ?? obj.arguments ?? obj.input ?? {};
    if (!name || typeof name !== 'string') return null;
    if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch (e) { args = { raw: args }; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = { value: args };
    return { name, arguments: JSON.stringify(args) };
}

function parseJsonToolCandidate(raw, label = 'json') {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        const tc = coerceToolCallObject(parsed);
        if (tc) {
            console.log(`[parseToolCall] 成功 ${label}: ${tc.name}（参数=${tc.arguments.length} 字符）`);
            return tc;
        }
    } catch (e) {
        console.log(`[parseToolCall] ${label} JSON.parse 失败: ${e.message.substring(0, 100)}`);
    }
    return null;
}

function parseToolCall(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. XML-ish wrappers used by some agent prompts.
    const xmlMatch = text.match(/<tool_call[^>]*>([\s\S]*?)<\/tool_call>/i);
    if (xmlMatch) {
        const inner = xmlMatch[1].trim();
        const tc = parseJsonToolCandidate(inner, 'xml');
        if (tc) return tc;
    }

    // 2. Function call XML format: <function_calls><invoke name="...">...
    const funcCallMatch = text.match(/<function_calls>[\s\S]*?<invoke\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>[\s\S]*?<\/function_calls>/i);
    if (funcCallMatch) {
        const name = funcCallMatch[1];
        const inner = funcCallMatch[2].trim();
        const tc = parseJsonToolCandidate(inner, 'func_call_xml');
        if (tc) return tc;
        // If inner is not JSON, try to parse as key=value pairs
        if (inner && !inner.startsWith('{')) {
            console.log(`[parseToolCall] func_call_xml: ${name} 非 JSON 参数，包装处理`);
            return { name, arguments: JSON.stringify({ raw: inner }) };
        }
    }

    // 3. Fenced JSON blocks.
    const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fence;
    while ((fence = fenceRe.exec(text)) !== null) {
        const tc = parseJsonToolCandidate(fence[1].trim(), 'fenced');
        if (tc) return tc;
    }

    // 4. Legacy TOOL_CALL: name + first balanced JSON object after it.
    const match = text.match(/TOOL_CALL:\s*([\w-]+)\s*/i);
    if (match) {
        const name = match[1];
        const afterMatch = text.substring(match.index + match[0].length);
        const braceIdx = afterMatch.indexOf('{');
        if (braceIdx !== -1) {
            const rawJson = extractBalancedJsonAt(afterMatch, braceIdx);
            if (rawJson) {
                try {
                    const args = JSON.parse(rawJson);
                    console.log(`[parseToolCall] 成功 legacy: ${name}（参数=${rawJson.length} 字符）`);
                    return { name, arguments: JSON.stringify(args) };
                } catch (e) {
                    console.log(`[parseToolCall] legacy JSON.parse 失败: ${e.message.substring(0,100)}`);
                }
            } else {
                console.log(`[parseToolCall] TOOL_CALL:${name} 找到但 JSON 括号不平衡`);
            }
        } else {
            console.log(`[parseToolCall] TOOL_CALL:${name} 找到但后面没有 {`);
        }
    }

    // 5. "Tool called: name" or "Calling tool: name" patterns
    const toolCalledMatch = text.match(/(?:Tool|called|Calling)\s*(?:called|tool)?\s*:?\s*["']?([\w-]+)["']?\s*(?:with|args|arguments|params)?\s*:?\s*(\{[\s\S]*?\})/i);
    if (toolCalledMatch) {
        const name = toolCalledMatch[1];
        const rawJson = toolCalledMatch[2];
        try {
            const args = JSON.parse(rawJson);
            console.log(`[parseToolCall] 成功 tool_called: ${name}`);
            return { name, arguments: JSON.stringify(args) };
        } catch (e) {
            console.log(`[parseToolCall] tool_called JSON.parse 失败: ${e.message.substring(0,100)}`);
        }
    }

    // 6. First balanced JSON object in the whole response. Supports:
    // {"tool_call":{"name":"...","arguments":{...}}}, {"name":"...","arguments":{...}}, etc.
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '{') continue;
        const rawJson = extractBalancedJsonAt(text, i);
        if (!rawJson) continue;
        const tc = parseJsonToolCandidate(rawJson, 'inline');
        if (tc) return tc;
    }

    // 7. Last resort: look for "name" and "arguments" keys anywhere in the text
    // This handles cases where the JSON is embedded in natural language
    const nameMatch = text.match(/["']name["']\s*:\s*["']([^"']+)["']/i);
    const argsMatch = text.match(/["']arguments["']\s*:\s*(\{[\s\S]*?\})/i);
    if (nameMatch && argsMatch) {
        try {
            const args = JSON.parse(argsMatch[1]);
            console.log(`[parseToolCall] 成功 loose_match: ${nameMatch[1]}`);
            return { name: nameMatch[1], arguments: JSON.stringify(args) };
        } catch (e) {
            console.log(`[parseToolCall] loose_match JSON.parse 失败: ${e.message.substring(0,100)}`);
        }
    }

    console.log(`[parseToolCall] 未匹配到工具调用（${text.length} 字符）`);
    return null;
}

function detectMultipleToolCalls(text) {
    if (!text || typeof text !== 'string') return false;
    const toolCallMatches = (text.match(/TOOL_CALL:\s*\w/gi) || []).length;
    const jsonToolMatches = (text.match(/\{"tool_call":/gi) || []).length;
    const xmlToolMatches = (text.match(/<tool_call[^>]*>/gi) || []).length;
    const invokeMatches = (text.match(/<invoke\s+name\s*=/gi) || []).length;
    return (toolCallMatches + jsonToolMatches + xmlToolMatches + invokeMatches) > 1;
}

/**
 * Strip surrogate characters and other problematic Unicode from text
 * to prevent httpx/urlencode crashes when the gateway sends to Telegram.
 */
function sanitizeContent(text) {
    return text.replace(/[\ud800-\udfff]/g, '');
}

function estimateTokens(text) {
    return text ? Math.ceil(String(text).length / 4) : 0;
}

function buildUsage(prompt, content, reasoningContent = '') {
    const promptTokens = estimateTokens(prompt);
    const contentTokens = estimateTokens(content);
    const reasoningTokens = estimateTokens(reasoningContent);
    const completionTokens = contentTokens + reasoningTokens;
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        completion_tokens_details: {
            reasoning_tokens: reasoningTokens
        }
    };
}

function buildToolCallResponse(toolCall, model = 'deepseek-default', prompt = '', reasoningContent = '') {
    const id = 'call_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const message = {
        role: 'assistant',
        content: null,
        tool_calls: [{
            id: id,
            type: 'function',
            function: { name: toolCall.name, arguments: toolCall.arguments }
        }]
    };
    // Do not attach reasoning to tool-call turns. Some agent clients treat any
    // reasoning/text payload as a final assistant answer and stop their tool loop.
    return {
        id: 'ds-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message,
            finish_reason: 'tool_calls'
        }],
        usage: buildUsage(prompt, '', reasoningContent),
        watermark: FORGETMEAI_WATERMARK
    };
}

function buildTextResponse(content, prompt, model = 'deepseek-default', reasoningContent = '') {
    const message = { role: 'assistant', content };
    if (reasoningContent) message.reasoning_content = reasoningContent;
    return {
        id: 'ds-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            message,
            finish_reason: 'stop'
        }],
        usage: buildUsage(prompt, content, reasoningContent),
        watermark: FORGETMEAI_WATERMARK
    };
}

function normalizeMessageContent(content) {
    if (content === null || content === undefined) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => {
            if (typeof part === 'string') return part;
            if (!part || typeof part !== 'object') return '';
            if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') return part.text || '';
            if (part.type === 'tool_result') return `[Tool Result ${part.tool_use_id || ''}]\n${normalizeMessageContent(part.content)}`;
            if (part.type === 'image_url') {
                const url = part.image_url?.url || '';
                // Preserve image URL info for vision model processing
                // The actual upload happens in formatMessages -> processImageMessages
                return `[Image: ${url}]`;
            }
            return part.text || part.content || JSON.stringify(part);
        }).filter(Boolean).join('\n');
    }
    return String(content);
}

function normalizeAnthropicTools(tools = []) {
    return (tools || []).map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} }
        }
    })).filter(tool => tool.function.name);
}

function normalizeResponsesTools(tools = []) {
    return (tools || []).map(tool => {
        if (tool.type === 'function' && tool.function) return tool;
        if (tool.type === 'function' && tool.name) {
            return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: tool.parameters || { type: 'object', properties: {} } } };
        }
        return null;
    }).filter(Boolean);
}

function normalizeResponsesInput(input) {
    if (typeof input === 'string') return [{ role: 'user', content: input }];
    if (!Array.isArray(input)) return [];
    const messages = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') continue;
        if (item.type === 'message') {
            messages.push({ role: item.role || 'user', content: normalizeMessageContent(item.content) });
        } else if (item.role) {
            messages.push({ role: item.role, content: normalizeMessageContent(item.content) });
        } else if (item.type === 'function_call_output') {
            messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output || '' });
        } else if (item.type === 'input_text') {
            messages.push({ role: 'user', content: item.text || '' });
        }
    }
    return messages;
}

function normalizeApiParams(params, apiMode) {
    if (apiMode === 'anthropic') {
        const messages = [];
        if (params.system) messages.push({ role: 'system', content: normalizeMessageContent(params.system) });
        for (const msg of params.messages || []) {
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                const toolUses = msg.content.filter(part => part && part.type === 'tool_use');
                const text = normalizeMessageContent(msg.content.filter(part => !part || part.type !== 'tool_use'));
                if (text) messages.push({ role: 'assistant', content: text });
                for (const tu of toolUses) {
                    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: tu.id, type: 'function', function: { name: tu.name, arguments: JSON.stringify(tu.input || {}) } }] });
                }
            } else if (msg.role === 'user' && Array.isArray(msg.content) && msg.content.some(part => part && part.type === 'tool_result')) {
                for (const part of msg.content) {
                    if (part && part.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: part.tool_use_id, content: normalizeMessageContent(part.content) });
                    else messages.push({ role: 'user', content: normalizeMessageContent(part) });
                }
            } else {
                messages.push({ role: msg.role || 'user', content: normalizeMessageContent(msg.content) });
            }
        }
        return {
            ...params,
            model: params.model || 'deepseek-chat',
            messages,
            tools: normalizeAnthropicTools(params.tools || []),
            stream: params.stream === true,
            user: params.metadata?.user_id || params.user,
        };
    }
    if (apiMode === 'responses') {
        const messages = normalizeResponsesInput(params.input);
        if (params.instructions) messages.unshift({ role: 'system', content: params.instructions });
        return {
            ...params,
            model: params.model || 'deepseek-chat',
            messages,
            tools: normalizeResponsesTools(params.tools || []),
            stream: params.stream === true,
            user: params.user,
        };
    }
    return params;
}

function safeJsonParseObject(text, fallback = {}) {
    try {
        const parsed = JSON.parse(text || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (e) {
        return fallback;
    }
}

function toAnthropicResponse(openaiResp) {
    const choice = openaiResp.choices[0];
    const msg = choice.message || {};
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    const content = [];
    if (hasToolCalls) {
        for (const tc of msg.tool_calls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeJsonParseObject(tc.function.arguments) });
        }
    } else {
        content.push({ type: 'text', text: msg.content || '' });
    }
    const response = {
        id: 'msg_' + openaiResp.id,
        type: 'message',
        role: 'assistant',
        model: openaiResp.model,
        content,
        stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: {
            input_tokens: openaiResp.usage?.prompt_tokens || 0,
            output_tokens: openaiResp.usage?.completion_tokens || 0,
        },
        watermark: FORGETMEAI_WATERMARK,
    };
    if (!hasToolCalls && msg.reasoning_content) response.reasoning_content = msg.reasoning_content;
    return response;
}

function writeSse(res, event, data) {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendAnthropicStream(res, openaiResp) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const choice = openaiResp.choices[0];
    const msg = choice.message || {};
    const message = toAnthropicResponse(openaiResp);
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    writeSse(res, 'message_start', { type: 'message_start', message: { ...message, content: [] } });

    // Anthropic-compatible clients expect a tool turn to be made of tool_use
    // content blocks. If we emit DeepSeek reasoning as a text block before the
    // tool_use block, some agents treat the turn as a normal text answer and do
    // not execute the tool. Keep tool streaming clean: tool_use blocks only.
    if (hasToolCalls) {
        msg.tool_calls.forEach((tc, i) => {
            writeSse(res, 'content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: tc.id, name: tc.function.name, input: {} } });
            writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: tc.function.arguments || '{}' } });
            writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: i });
        });
        writeSse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: message.usage });
    } else {
        if (msg.reasoning_content) {
            writeSse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
            writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `[reasoning]\n${msg.reasoning_content}\n[/reasoning]\n` } });
            writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
        }
        const offset = msg.reasoning_content ? 1 : 0;
        writeSse(res, 'content_block_start', { type: 'content_block_start', index: offset, content_block: { type: 'text', text: '' } });
        const text = msg.content || '';
        for (let i = 0; i < text.length; i += 80) {
            writeSse(res, 'content_block_delta', { type: 'content_block_delta', index: offset, delta: { type: 'text_delta', text: text.substring(i, i + 80) } });
        }
        writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: offset });
        writeSse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: message.usage });
    }
    writeSse(res, 'message_stop', { type: 'message_stop' });
    res.end();
}

function toResponsesResponse(openaiResp) {
    const choice = openaiResp.choices[0];
    const msg = choice.message || {};
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    const output = [];
    if (!hasToolCalls && msg.reasoning_content) {
        output.push({ id: 'rs_' + Date.now(), type: 'reasoning', summary: [{ type: 'summary_text', text: msg.reasoning_content }] });
    }
    if (hasToolCalls) {
        for (const tc of msg.tool_calls) {
            output.push({ type: 'function_call', id: 'fc_' + tc.id, call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || '{}' });
        }
    } else {
        output.push({ id: 'msg_' + Date.now(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: msg.content || '', annotations: [] }] });
    }
    return {
        id: openaiResp.id.replace(/^ds-/, 'resp_'),
        object: 'response',
        created_at: openaiResp.created,
        status: 'completed',
        model: openaiResp.model,
        output,
        output_text: msg.content || '',
        usage: {
            input_tokens: openaiResp.usage?.prompt_tokens || 0,
            output_tokens: openaiResp.usage?.completion_tokens || 0,
            total_tokens: openaiResp.usage?.total_tokens || 0,
            output_tokens_details: { reasoning_tokens: openaiResp.usage?.completion_tokens_details?.reasoning_tokens || 0 },
        },
        watermark: FORGETMEAI_WATERMARK,
    };
}

function sendResponsesStream(res, openaiResp) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const response = toResponsesResponse(openaiResp);
    const choice = openaiResp.choices[0];
    const msg = choice.message || {};
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    writeSse(res, 'response.created', { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } });
    writeSse(res, 'response.in_progress', { type: 'response.in_progress', response: { ...response, status: 'in_progress', output: [] } });
    let outputIndex = 0;
    if (!hasToolCalls && msg.reasoning_content) {
        const reasoningItem = { id: 'rs_' + Date.now(), type: 'reasoning', summary: [], status: 'completed' };
        writeSse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: outputIndex, item: { ...reasoningItem, status: 'in_progress' } });
        writeSse(res, 'response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', output_index: outputIndex, summary_index: 0, delta: msg.reasoning_content });
        writeSse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: outputIndex, item: { ...reasoningItem, summary: [{ type: 'summary_text', text: msg.reasoning_content }] } });
        outputIndex++;
    }
    if (hasToolCalls) {
        msg.tool_calls.forEach((tc) => {
            const item = { type: 'function_call', id: 'fc_' + tc.id, call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || '{}', status: 'completed' };
            writeSse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: outputIndex, item: { ...item, arguments: '', status: 'in_progress' } });
            writeSse(res, 'response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', output_index: outputIndex, item_id: item.id, delta: item.arguments });
            writeSse(res, 'response.function_call_arguments.done', { type: 'response.function_call_arguments.done', output_index: outputIndex, item_id: item.id, arguments: item.arguments });
            writeSse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: outputIndex, item });
            outputIndex++;
        });
    } else {
        const text = msg.content || '';
        const item = { id: 'msg_' + Date.now(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
        writeSse(res, 'response.output_item.added', { type: 'response.output_item.added', output_index: outputIndex, item: { ...item, status: 'in_progress', content: [] } });
        writeSse(res, 'response.content_part.added', { type: 'response.content_part.added', output_index: outputIndex, content_index: 0, item_id: item.id, part: { type: 'output_text', text: '', annotations: [] } });
        for (let i = 0; i < text.length; i += 80) {
            writeSse(res, 'response.output_text.delta', { type: 'response.output_text.delta', output_index: outputIndex, content_index: 0, item_id: item.id, delta: text.substring(i, i + 80) });
        }
        writeSse(res, 'response.output_text.done', { type: 'response.output_text.done', output_index: outputIndex, content_index: 0, item_id: item.id, text });
        writeSse(res, 'response.content_part.done', { type: 'response.content_part.done', output_index: outputIndex, content_index: 0, item_id: item.id, part: item.content[0] });
        writeSse(res, 'response.output_item.done', { type: 'response.output_item.done', output_index: outputIndex, item });
    }
    writeSse(res, 'response.completed', { type: 'response.completed', response });
    res.write('data: [DONE]\n\n');
    res.end();
}

function sendOpenAIStream(res, openaiResp) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const choice = openaiResp.choices[0];
    const msg = choice.message || {};
    const id = openaiResp.id;
    const created = openaiResp.created;
    const model = openaiResp.model;
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    if (!hasToolCalls && msg.reasoning_content) {
        for (let i = 0; i < msg.reasoning_content.length; i += 50) {
            const chunk = msg.reasoning_content.substring(i, i + 50);
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { reasoning_content: chunk }, finish_reason: null }] })}\n\n`);
        }
    }
    if (hasToolCalls) {
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: msg.tool_calls }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
    } else {
        for (let i = 0; i < (msg.content || '').length; i += 50) {
            const chunk = msg.content.substring(i, i + 50);
            res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }
    res.end();
}

function storeHistory(agentId, prompt, content, toolCall) {
    const session = getOrCreateAgentSession(agentId);
    const assistantResponse = toolCall
        ? `TOOL_CALL: ${toolCall.name}\narguments: ${toolCall.arguments}`
        : content;
    // Save last 500 chars of the prompt for history context
    const shortPrompt = prompt.length > 500 ? '...' + prompt.substring(prompt.length - 500) : prompt;
    session.history.push({ user: shortPrompt, assistant: assistantResponse });
    while (session.history.length > MAX_HISTORY_LENGTH) session.history.shift();
    let historyChars = session.history.reduce((sum, e) => sum + e.user.length + e.assistant.length, 0);
    while (historyChars > MAX_HISTORY_CHARS && session.history.length > 1) {
        const removed = session.history.shift();
        historyChars -= removed.user.length + removed.assistant.length;
    }
}

// Extract MEDIA: paths from tool results that contain screenshot paths
function extractScreenshotPaths(messages) {
    const paths = [];
    const fs = require('fs');
    for (const msg of messages) {
        if (msg.role === 'tool' && msg.content) {
            // Look for screenshot_path or path fields in JSON tool results
            // These come DIRECTLY from browser_vision — always the real path
            const pngMatch = msg.content.match(/["'](screenshot_path|path)["']\s*:\s*["']([^"']+\.(?:png|jpg|jpeg|webp|gif))["']/i);
            if (pngMatch) {
                const filePath = pngMatch[2];
                if (filePath.startsWith('/') && fs.existsSync(filePath)) {
                    paths.push(`MEDIA:${filePath}`);
                }
            }
            // Also catch plain MEDIA: tags
            const mediaMatch = msg.content.match(/MEDIA:(\S+)/g);
            if (mediaMatch) {
                for (const tag of mediaMatch) {
                    const extractedPath = tag.replace(/^MEDIA:/, '');
                    if (fs.existsSync(extractedPath) && !paths.includes(tag)) {
                        paths.push(tag);
                    }
                }
            }
        }
        // Check user/assistant messages for paths mentioned in conversation text
        // Only include if the file ACTUALLY EXISTS (DeepSeek hallucinates paths)
        if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            const pathRegex = /(\/[^\s<>"']+\.(?:png|jpg|jpeg|webp|gif))/gi;
            let match;
            while ((match = pathRegex.exec(content)) !== null) {
                const filePath = match[1];
                if (filePath.startsWith('/') && fs.existsSync(filePath) && !paths.includes(`MEDIA:${filePath}`)) {
                    paths.push(`MEDIA:${filePath}`);
                }
            }
        }
    }
    return paths;
}

function formatMessages(messages, tools, promptInjection = '') {
    let systemPrompt = '';
    for (const msg of messages) {
        if (msg.role === 'system' && msg.content) {
            systemPrompt += msg.content + '\n';
        }
    }
    systemPrompt += formatToolDefinitions(tools);

    // Apply prompt injection if provided — this OVERRIDES the original system prompt
    // when the injection is strong enough, or APPENDS to it
    if (promptInjection) {
        if (promptInjection.startsWith('OVERRIDE:')) {
            // Full override: replace the entire system prompt
            systemPrompt = promptInjection.substring(9).trim();
            console.log(`[formatMessages] 提示词注入 OVERRIDE 已应用（${systemPrompt.length} 字符）`);
        } else if (promptInjection.startsWith('PREPEND:')) {
            // Prepend to system prompt
            systemPrompt = promptInjection.substring(8).trim() + '\n\n' + systemPrompt;
            console.log(`[formatMessages] 提示词注入 PREPEND 已应用`);
        } else {
            // Default: append to system prompt (strong injection at the end)
            systemPrompt = systemPrompt + '\n\n' + promptInjection;
            console.log(`[formatMessages] 提示词注入 APPEND 已应用（${promptInjection.length} 字符）`);
        }
    }

    // Build full conversation history for DeepSeek's context
    let conversation = '';
    for (const msg of messages) {
        if (msg.role === 'system') continue;  // already in systemPrompt
        if (msg.role === 'user' && msg.content) {
            // Handle user messages that may contain image_url parts
            const content = normalizeMessageContent(msg.content);
            conversation += `User: ${content}\n\n`;
        } else if (msg.role === 'assistant') {
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                // This was a tool call response from a previous turn
                for (const tc of msg.tool_calls) {
                    conversation += `Assistant: TOOL_CALL: ${tc.function.name}\narguments: ${tc.function.arguments}\n\n`;
                }
            } else if (msg.content) {
                conversation += `Assistant: ${msg.content}\n\n`;
            }
        } else if (msg.role === 'tool' && msg.content) {
            // Tool execution result — send back to DeepSeek as context
            const truncated = msg.content.length > 8000
                ? msg.content.substring(0, 8000) + '\n...[truncated]'
                : msg.content;
            conversation += `[Tool Result]\n${truncated}\n\n`;
        }
    }
    // The last user message + full conversation context
    return { prompt: conversation.trim(), systemPrompt: systemPrompt.trim() };
}

// === HTTP Server ===
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-prompt-injection, x-prompt-override');
    res.setHeader('Access-Control-Expose-Headers', 'x-prompt-injection, x-prompt-override');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    const proxyAuthConfig = proxyKeyStore.getConfig();
    const proxyAuthRequired = proxyDefaults.proxyRequireAuth || proxyAuthConfig.enabled;
    const isApiEndpoint = req.method === 'POST' &&
        ['/v1/chat/completions', '/v1/messages', '/v1/responses'].includes(url.pathname);
    if (proxyAuthRequired && isApiEndpoint) {
        const authMw = new AuthMiddleware({
            enabled: true,
            apiKeys: proxyAuthConfig.apiKeys,
            bearerTokens: proxyAuthConfig.bearerTokens,
            ipWhitelist: proxyAuthConfig.ipWhitelist,
        });
        authMw.authenticate(req, res, () => {});
        if (res.headersSent) return;
    }

    // Health check
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'FreeDeepseekAPI', watermark: FORGETMEAI_WATERMARK, models: SUPPORTED_MODEL_IDS, unsupported_models: Object.keys(MODEL_CONFIGS).filter(id => !MODEL_CONFIGS[id].supported), agents: sessions.size, accounts: accounts.map(accountStatus), config_ready: hasAuthConfig(), session_reuse: { strategy: 'sticky per x-agent-session/user', ttl_minutes: Math.round(SESSION_TTL_MS / 60000), max_messages: MAX_MESSAGE_DEPTH, reset_all: 'POST /reset-session?agent=all' } }));
        return;
    }

    // Models: OpenAI-compatible list exposes only aliases verified to work through this proxy.
    if (req.method === 'GET' && url.pathname === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: SUPPORTED_MODEL_IDS.map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'deepseek-web', real_model: MODEL_CONFIGS[id].real_model, capabilities: MODEL_CONFIGS[id].capabilities })) }));
        return;
    }

    // Full mapping, including Web models observed but not currently usable through the direct API.
    if (req.method === 'GET' && (url.pathname === '/v1/model-capabilities' || url.pathname === '/api/model-capabilities')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'model_capabilities', watermark: FORGETMEAI_WATERMARK, data: ALL_MODEL_CAPABILITIES }));
        return;
    }

    // Account management
    if (req.method === 'GET' && url.pathname === '/admin/accounts') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(accounts.map(accountStatus)));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/accounts/reload') {
        loadDeepSeekConfig({ fatal: false });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reloaded: true, count: accounts.length }));
        return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/admin/accounts/') && url.pathname.endsWith('/toggle')) {
        const accId = url.pathname.split('/')[3];
        const acc = accounts.find(a => a.id === accId);
        if (acc) {
            acc.enabled = !(acc.enabled !== false);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: acc.id, enabled: acc.enabled !== false }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Account not found' }));
        }
        return;
    }

    // Sessions status
    if (req.method === 'GET' && url.pathname === '/v1/sessions') {
        const agentList = [];
        for (const [agentId, session] of sessions) {
            agentList.push({
                agent: agentId,
                session_id: session.id,
                message_count: session.messageCount,
                account: session.accountId,
                history_size: session.history.length,
                age_min: session.createdAt ? Math.round((Date.now() - session.createdAt) / 60000) : 0,
                bootstrap_injected: session.bootstrapInjected || false,
                last_response_message_id: session.lastResponseMessageId || null,
                last_finish_reason: session.lastFinishReason || null,
            });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ agents: agentList, total: agentList.length }));
        return;
    }

    // Reset session for a specific agent (or all if no agent specified)
    if (req.method === 'POST' && url.pathname === '/reset-session') {
        const agentId = url.searchParams.get('agent') || 'default';
        if (agentId === 'all') {
            const count = sessions.size;
            sessions.clear();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'all_sessions_cleared', count }));
            return;
        }
        const session = sessions.get(agentId);
        if (!session) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `No session for agent: ${agentId}` }));
            return;
        }
        const historyCount = session.history.length;
        const historyPreview = session.history.map(e => e.user.substring(0, 40)).join(' | ');
        resetWebSession(session);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'session_reset', agent: agentId, history_preserved: historyCount, history: historyPreview }));
        return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/proxy-auth') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(proxyKeyStore.getConfig()));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/proxy-auth/enable') {
        proxyKeyStore.setEnabled(true);
        proxyKeyStore.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: true }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/proxy-auth/disable') {
        proxyKeyStore.setEnabled(false);
        proxyKeyStore.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: false }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/proxy-auth/generate-api-key') {
        const key = proxyKeyStore.generateApiKey();
        proxyKeyStore.addApiKey(key);
        proxyKeyStore.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ apiKey: key }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/proxy-auth/generate-bearer-token') {
        const token = proxyKeyStore.generateBearerToken();
        proxyKeyStore.addBearerToken(token);
        proxyKeyStore.save();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ bearerToken: token }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/proxy-auth/remove-api-key') {
        const body = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
        const { apiKey } = JSON.parse(body || '{}');
        if (apiKey) { proxyKeyStore.removeApiKey(apiKey); proxyKeyStore.save(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ removed: !!apiKey }));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/proxy-auth/remove-bearer-token') {
        const body = await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
        const { bearerToken } = JSON.parse(body || '{}');
        if (bearerToken) { proxyKeyStore.removeBearerToken(bearerToken); proxyKeyStore.save(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ removed: !!bearerToken }));
        return;
    }

    const apiMode = url.pathname === '/v1/messages'
        ? 'anthropic'
        : (url.pathname === '/v1/responses' ? 'responses' : 'openai');
    const acceptedPostPaths = ['/v1/chat/completions', '/v1/messages', '/v1/responses'];
    if (req.method !== 'POST' || !acceptedPostPaths.includes(url.pathname)) {
        res.writeHead(404); res.end('Not found'); return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const rawParams = JSON.parse(body || '{}');
            const params = normalizeApiParams(rawParams, apiMode);
            const messages = params.messages || [];
            const tools = params.tools || [];
            const stream = params.stream === true;
            const requestedModel = String(params.model || 'deepseek-chat').toLowerCase();
            if (!isKnownModel(requestedModel)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `Unknown model: ${requestedModel}`, type: 'invalid_model', supported_models: SUPPORTED_MODEL_IDS, model_capabilities_url: '/v1/model-capabilities' } }));
                return;
            }
            if (!isSupportedModel(requestedModel)) {
                const cfg = resolveModelConfig(requestedModel);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `${requestedModel} is not currently supported through this DeepSeek Web API path`, type: 'unsupported_model', model: requestedModel, real_model: cfg.real_model, reason: cfg.unavailable_reason, capabilities: cfg.capabilities, supported_models: SUPPORTED_MODEL_IDS } }));
                return;
            }
            // Use remote IP for session isolation (local gets 'dev-agent', external per-IP)
            const remoteAddr = req.socket.remoteAddress || 'unknown';
            const requestedSession = req.headers['x-agent-session'] || params.session || params.user;
            const agentId = requestedSession
                ? String(requestedSession)
                : ((remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') ? 'dev-agent' : remoteAddr);
            const agentTag = `[${agentId}]`;
            // === Prompt Injection Support ===
            // Check for prompt injection from multiple sources (priority order):
            // 1. x-prompt-injection header (highest priority)
            // 2. prompt_injection field in request body
            // 3. x-prompt-override header (full override)
            let promptInjection = '';
            const headerInjection = req.headers['x-prompt-injection'];
            const headerOverride = req.headers['x-prompt-override'];
            const bodyInjection = rawParams.prompt_injection;

            if (headerOverride) {
                promptInjection = 'OVERRIDE:' + headerOverride;
                console.log(`${agentTag} 提示词覆盖来自请求头（${headerOverride.length} 字符）`);
            } else if (headerInjection) {
                promptInjection = headerInjection;
                console.log(`${agentTag} 提示词注入来自请求头（${headerInjection.length} 字符）`);
            } else if (bodyInjection) {
                promptInjection = bodyInjection;
                console.log(`${agentTag} 提示词注入来自请求体（${bodyInjection.length} 字符）`);
            } else if (DEFAULT_INJECTION_PROMPT && tools && tools.length > 0) {
                promptInjection = DEFAULT_INJECTION_PROMPT;
            }

            const { prompt, systemPrompt } = formatMessages(messages, tools, promptInjection);

            const session = getOrCreateAgentSession(agentId);

            // Build history prefix if starting fresh
            let historyPrefix = '';
            if (!session.id && session.history.length > 0) {
                historyPrefix = '[Previous conversation]\n';
                for (const exchange of session.history) {
                    historyPrefix += `User: ${exchange.user}\nAssistant: ${exchange.assistant}\n\n`;
                }
                historyPrefix += '[Continue from here]\n\n';
            }

            const fullPrompt = systemPrompt
                ? `${systemPrompt}\n\n${historyPrefix}${prompt}`
                : `${historyPrefix}${prompt}`;

            const startTime = Date.now();

            // === Vision Model Support: Auto-upload images ===
            // Auto-detect images in messages regardless of model name.
            // If messages contain image_url parts, upload them to DeepSeek's file API.
            const modelCfg = resolveModelConfig(requestedModel);
            let refFileIds = [];
            const hasImages = messages.some(msg =>
                Array.isArray(msg.content) && msg.content.some(part =>
                    part && typeof part === 'object' && part.type === 'image_url'
                )
            );
            if (hasImages) {
                try {
                    const account = selectAccountForSession(session);
                    refFileIds = await processImageMessages(messages, account, modelCfg);
                    if (refFileIds.length > 0) {
                        console.log(`${agentTag} 已上传 ${refFileIds.length} 张图片: ${refFileIds.join(', ')}`);
                    }
                } catch (e) {
                    console.log(`${agentTag} 图片上传失败（非致命）: ${e.message}`);
                    // Non-fatal: proceed without images if upload fails
                }
            }

            // === DeepSeek 图片插入流程 ===
            // DeepSeek 网页端的上图流程是两步走：
            // 1. 上传文件 -> 获取 file_id（上面已完成）
            // 2. 发送一个空提示词的 completion 请求（仅带 ref_file_ids），将图片"插入"到对话中
            // 3. 然后再发送实际的用户文本请求（不带 ref_file_ids，因为图片已在对话历史中）
            // 参考捕获数据：ds_withFile: "true", ds_promptLength: 3（极短提示词）
            if (refFileIds.length > 0) {
                try {
                    console.log(`${agentTag} 正在将图片插入 DeepSeek 对话...`);
                    const { resp: insertResp } = await askDeepSeekStream('', agentId, requestedModel, refFileIds);
                    // 消费掉这个插入请求的响应流，确保会话状态更新
                    const reader = insertResp.body.getReader();
                    const decoder = new TextDecoder();
                    let insertBuffer = '';
                    let insertDone = false;
                    while (!insertDone) {
                        const { done, value } = await reader.read();
                        insertDone = done;
                        if (value) {
                            insertBuffer += decoder.decode(value, { stream: true });
                        }
                    }
                    console.log(`${agentTag} 图片已插入对话`);
                } catch (e) {
                    console.log(`${agentTag} 图片插入对话失败（非致命）: ${e.message}`);
                    // Non-fatal: proceed even if image insertion fails
                }
            }

            await performBootstrapInjection(session, agentId, requestedModel, agentTag);

            const { resp: dsResp } = await askDeepSeekStream(fullPrompt, agentId, requestedModel, []);

            // Process streaming response from DeepSeek — returns { content, reasoningContent, messageId, finishReason }
            async function readDeepSeekResponse(readable) {
                let buffer = '';
                let lastPath = null;
                const fragments = [];
                let fullContent = '';
                let reasoningContent = '';
                let newMessageId = null;
                let finishReason = null;
                let modelError = null;

                const rebuildFragmentState = () => {
                    const { responseText, thinkText } = rebuildFragmentText(fragments);
                    if (responseText) fullContent = responseText;
                    reasoningContent = thinkText;
                };

                const appendFragments = (value) => {
                    const incoming = Array.isArray(value) ? value : [value];
                    for (const fragment of incoming) {
                        if (fragment && typeof fragment === 'object') fragments.push({ ...fragment });
                    }
                    rebuildFragmentState();
                };

                for await (const chunk of readable) {
                    buffer += new TextDecoder().decode(chunk, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const d = JSON.parse(line.slice(6));
                                if (d.response_message_id !== undefined && !newMessageId) newMessageId = d.response_message_id;
                                if (isDeepSeekModelErrorEvent(d)) {
                                    modelError = { type: d.type || 'error', content: d.content || '', finish_reason: d.finish_reason || null };
                                }
                                if (d.finish_reason) {
                                    finishReason = d.finish_reason;
                                }
                                if (d.p !== undefined) lastPath = d.p;
                                if (d.v && typeof d.v === 'object' && d.v.response) {
                                    if (d.v.response.message_id !== undefined) {
                                        newMessageId = d.v.response.message_id;
                                    }
                                    if (d.v.response.content !== undefined) {
                                        fullContent = d.v.response.content;
                                    }
                                    if (Array.isArray(d.v.response.fragments)) {
                                        fragments.length = 0;
                                        appendFragments(d.v.response.fragments);
                                    }
                                    if (d.v.response.finish_reason !== undefined) {
                                        finishReason = d.v.response.finish_reason;
                                    }
                                }
                                if (lastPath === 'response/fragments' && d.v !== undefined) {
                                    appendFragments(d.v);
                                }
                                if (lastPath === 'response' && d.v !== undefined) {
                                    applyResponsePatchOperations(d.v, appendFragments);
                                }
                                if (lastPath === 'response/fragments/-1/content' && d.v !== undefined && typeof d.v !== 'object') {
                                    if (fragments.length > 0) {
                                        const lastFragment = fragments[fragments.length - 1];
                                        lastFragment.content = `${lastFragment.content || ''}${d.v}`;
                                        rebuildFragmentState();
                                    }
                                }
                                if (lastPath === 'response/content' && d.v !== undefined && typeof d.v !== 'object') {
                                    fullContent += d.v;
                                }
                                if (lastPath === 'response/thinking_content' && d.v !== undefined && typeof d.v !== 'object') {
                                    reasoningContent += d.v;
                                }
                                if (lastPath === 'response/finish_reason' && d.v !== undefined) {
                                    finishReason = d.v;
                                }
                                if (lastPath === 'response/status' && d.v !== undefined && d.v !== 'FINISHED') {
                                    finishReason = d.v;
                                }
                                if (lastPath === 'response/quasi_status' && d.v !== undefined) {
                                    finishReason = finishReason || d.v;
                                }
                            } catch (e) { }
                        }
                    }
                }

                if (newMessageId) {
                    session.parentMessageId = newMessageId;
                    session.lastResponseMessageId = newMessageId;
                    session.messageCount++;
                } else {
                    console.log(`${agentTag} 警告: 无法提取 message_id`);
                }

                if (finishReason) {
                    session.lastFinishReason = finishReason;
                }

                return { content: fullContent, reasoningContent, messageId: newMessageId, finishReason, modelError };
            }

            let { content: fullContent, reasoningContent, finishReason, modelError } = await readDeepSeekResponse(dsResp.body);
            fullContent = sanitizeContent(fullContent);
            reasoningContent = sanitizeContent(reasoningContent || '');
            const elapsed = Date.now() - startTime;
            console.log(`${agentTag} 获取到 ${fullContent.length} 字符（+${reasoningContent.length} 推理字符），耗时 ${elapsed}ms（消息#${session.messageCount}）`);

            if ((!fullContent || fullContent.trim().length === 0) && modelError) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: modelError.content || 'DeepSeek returned an error without content', type: modelError.finish_reason || modelError.type || 'deepseek_model_error', model: requestedModel, real_model: resolveModelConfig(requestedModel).real_model } }));
                return;
            }

            // Empty response — retry loop with fresh sessions
            let retryAttempt = 0;
            const MAX_RETRIES = 10;
            while (!fullContent || fullContent.trim().length === 0) {
                retryAttempt++;
                if (retryAttempt > MAX_RETRIES) {
                    console.log(`${agentTag} 重试 ${MAX_RETRIES} 次后仍为空响应，放弃`);
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        error: { 
                            message: `DeepSeek returned empty content after ${MAX_RETRIES} retries`, 
                            type: 'empty_response',
                            agent: agentId,
                            session_id: session.id,
                            message_count: session.messageCount,
                            history_length: session.history.length,
                            retry_attempts: retryAttempt - 1,
                        } 
                    }));
                    return;
                }
                console.log(`${agentTag} 空响应（消息#${session.messageCount}，重试 ${retryAttempt}/${MAX_RETRIES}），重置会话...`);
                resetWebSession(session);
                // Brief delay before retry to let DeepSeek breathe
                await new Promise(r => setTimeout(r, Math.min(1000 * retryAttempt, 5000)));
                const { resp: retryResp } = await askDeepSeekStream(fullPrompt, agentId, requestedModel);
                const retryResult = await readDeepSeekResponse(retryResp.body);
                const retryContent = retryResult && retryResult.content ? sanitizeContent(retryResult.content) : '';
                const retryReasoning = retryResult && retryResult.reasoningContent ? sanitizeContent(retryResult.reasoningContent) : '';
                if (retryContent && retryContent.trim().length > 0) {
                    console.log(`${agentTag} 重试 ${retryAttempt} 成功`);
                    fullContent = retryContent;
                    reasoningContent = retryReasoning;
                }
            }

            // Auto-continuation: use real /api/v0/chat/continue when response is incomplete
            let continuationRounds = 0;
            const MAX_CONTINUATION = 2;
            while ((finishReason === 'length' || fullContent.length > 25000) && continuationRounds < MAX_CONTINUATION) {
                continuationRounds++;
                console.log(`${agentTag} 响应 ${fullContent.length} 字符（结束原因=${finishReason}），真实 continue（${continuationRounds}/${MAX_CONTINUATION}）...`);
                await new Promise(r => setTimeout(r, 500));
                const contAccount = selectAccountForSession(session);
                const contResp = await callDeepSeekContinue(session, contAccount, agentTag);
                if (!contResp) {
                    console.log(`${agentTag} continue 调用失败，回退到模拟续写`);
                    const { resp: fallbackResp } = await askDeepSeekStream('continue', agentId, requestedModel);
                    const fallbackResult = await readDeepSeekResponse(fallbackResp.body);
                    const fbContent = fallbackResult && fallbackResult.content ? sanitizeContent(fallbackResult.content) : '';
                    if (fbContent && fbContent.trim().length > 0) {
                        fullContent += '\n' + fbContent;
                        finishReason = fallbackResult.finishReason;
                    }
                    break;
                }
                const contResult = await readDeepSeekResponse(contResp.body);
                const contContent = contResult && contResult.content ? sanitizeContent(contResult.content) : '';
                const contReasoning = contResult && contResult.reasoningContent ? sanitizeContent(contResult.reasoningContent) : '';
                if (contContent && contContent.trim().length > 0 && !contContent.includes('I am an AI')) {
                    fullContent += '\n' + contContent;
                    if (contReasoning) reasoningContent += (reasoningContent ? '\n' : '') + contReasoning;
                    finishReason = contResult.finishReason;
                    console.log(`${agentTag} 续写添加了 ${contContent.length} 字符（总计: ${fullContent.length}）`);
                } else {
                    console.log(`${agentTag} 续写未返回有用内容，停止`);
                    break;
                }
            }

            let toolCall = parseToolCall(fullContent);
            if (toolCall && detectMultipleToolCalls(fullContent)) {
                console.log(`${agentTag} 检测到多个工具调用，仅使用第一个: ${toolCall.name}`);
            }
            
            // Retry if TOOL_CALL was found but JSON was truncated/invalid
            if (!toolCall && /TOOL_CALL:\s*\w/i.test(fullContent)) {
                console.log(`${agentTag} 检测到 TOOL_CALL 但 JSON 无效/截断（${fullContent.length} 字符），使用更严格的提示词重试...`);
                resetWebSession(session);
                await new Promise(r => setTimeout(r, 1000));
                const strictPrompt = fullPrompt + '\n\n[STRICT INSTRUCTION] Your previous response had a TOOL_CALL but the arguments were too long and got cut off. Keep the arguments SHORT — no large file contents. Just use a minimal example or reference the file by name. Output ONLY: TOOL_CALL: <function>\narguments: <short JSON>';
                const { resp: retryResp2 } = await askDeepSeekStream(strictPrompt, agentId, requestedModel);
                const retryResult2 = await readDeepSeekResponse(retryResp2.body);
                const retryContent2 = retryResult2 && retryResult2.content ? sanitizeContent(retryResult2.content) : '';
                if (retryContent2 && retryContent2.trim()) {
                    const retryTc = parseToolCall(retryContent2);
                    if (retryTc) {
                        console.log(`${agentTag} 严格提示词重试成功: ${retryTc.name}`);
                        fullContent = retryContent2;
                        reasoningContent = retryResult2.reasoningContent ? sanitizeContent(retryResult2.reasoningContent) : '';
                        toolCall = retryTc;
                    } else {
                        console.log(`${agentTag} 重试后 JSON 仍然损坏，作为文本发送`);
                        reasoningContent = retryResult2.reasoningContent ? sanitizeContent(retryResult2.reasoningContent) : reasoningContent;
                    }
                }
            }
            
            // Check if any tool results in the current conversation contained a screenshot path.
            // If so, and the response doesn't already have MEDIA:, inject it so the gateway
            // delivers the file to Telegram.
            if (!fullContent.includes('MEDIA:')) {
                const screenshotPaths = extractScreenshotPaths(messages);
                if (screenshotPaths.length > 0) {
                    fullContent += '\n\n' + screenshotPaths.join('\n');
                    console.log(`${agentTag} 已将 MEDIA 路径注入响应: ${screenshotPaths.join(', ')}`);
                }
            }

            storeHistory(agentId, prompt, fullContent, toolCall);

            const openaiResponse = toolCall
                ? buildToolCallResponse(toolCall, requestedModel, fullPrompt, reasoningContent)
                : buildTextResponse(fullContent, fullPrompt, requestedModel, reasoningContent);

            if (stream) {
                if (apiMode === 'anthropic') {
                    sendAnthropicStream(res, openaiResponse);
                } else if (apiMode === 'responses') {
                    sendResponsesStream(res, openaiResponse);
                } else {
                    sendOpenAIStream(res, openaiResponse);
                }
                console.log(`${agentTag} 流式输出 ${apiMode}（工具=${!!toolCall}），耗时 ${elapsed}ms`);
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                if (apiMode === 'anthropic') {
                    res.end(JSON.stringify(toAnthropicResponse(openaiResponse)));
                } else if (apiMode === 'responses') {
                    res.end(JSON.stringify(toResponsesResponse(openaiResponse)));
                } else {
                    res.end(JSON.stringify(openaiResponse));
                }
                console.log(`${agentTag} 响应 ${apiMode}（工具=${!!toolCall}，${elapsed}ms，${fullContent.length} 字符）`);
            }
        } catch (e) {
            console.log('[DS-API] 错误:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: e.message, type: 'server_error' } }));
        }
    });
});

async function runAuthScript() {
    const script = path.join(__dirname, 'scripts', 'deepseek_chrome_auth.js');
    const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
    loadDeepSeekConfig({ fatal: false });
    return result.status === 0 && hasAuthConfig();
}

function printStatus() {
    const paConfig = proxyKeyStore.getConfig();
    console.log(`\n${formatWatermark()}`);
    console.log(`认证状态: ${hasAuthConfig() ? '✅ 已配置' : '❌ 未找到 deepseek-auth.json'}`);
    console.log(`认证文件: ${process.env.DEEPSEEK_AUTH_DIR || DS_CONFIG_PATH}`);
    console.log(`账号: ${accounts.length ? accounts.map(a => `${a.id}${a.cooldownUntil > Date.now() ? ' (冷却中)' : ''}`).join(', ') : '无'}`);
    console.log(`代理鉴权: ${paConfig.enabled ? '🔒 已启用' : '🔓 未启用'}（API Keys: ${paConfig.apiKeys.length}, Bearer: ${paConfig.bearerTokens.length}）`);
    console.log(`注入提示词: ${BOOTSTRAP_INJECTION_ENABLED ? '✅' : '❌'}（${DEFAULT_INJECTION_PROMPT.length} 字符）`);
    console.log(`可用模型: ${SUPPORTED_MODEL_IDS.join(', ')}`);
}

async function showStartupMenu() {
    if (isTruthy(process.env.SKIP_ACCOUNT_MENU) || isTruthy(process.env.NON_INTERACTIVE)) {
        if (!hasAuthConfig()) loadDeepSeekConfig({ fatal: true });
        return true;
    }
    while (true) {
        printStatus();
        console.log('\n=== 菜单 ===');
        console.log(`ForgetMeAI: ${FORGETMEAI_WATERMARK}`);
        console.log('1 - 授权 / 更新 DeepSeek 登录');
        console.log('2 - 导入认证文件 / cookies');
        console.log('3 - 代理鉴权管理');
        console.log('4 - 启动代理（默认）');
        console.log('5 - 退出');
        let choice = await prompt('请选择（回车 = 4）: ');
        if (!choice) choice = '4';
        if (choice === '1') {
            await runAuthScript();
        } else if (choice === '2') {
            spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'auth_import.js')], { stdio: 'inherit', env: process.env });
            loadDeepSeekConfig({ fatal: false });
        } else if (choice === '3') {
            console.log('\n代理鉴权配置:');
            const pa = proxyKeyStore.getConfig();
            console.log(JSON.stringify(pa, null, 2));
            const sub = await prompt('\n启用/禁用 (e/d)，生成 Key (k)，生成 Token (t)，返回 (回车): ');
            if (sub === 'e') { proxyKeyStore.setEnabled(true); proxyKeyStore.save(); console.log('已启用'); }
            else if (sub === 'd') { proxyKeyStore.setEnabled(false); proxyKeyStore.save(); console.log('已禁用'); }
            else if (sub === 'k') { const k = proxyKeyStore.generateApiKey(); proxyKeyStore.addApiKey(k); proxyKeyStore.save(); console.log(`新 API Key: ${k}`); }
            else if (sub === 't') { const t = proxyKeyStore.generateBearerToken(); proxyKeyStore.addBearerToken(t); proxyKeyStore.save(); console.log(`新 Bearer Token: ${t}`); }
            await prompt('\n按 Enter 返回菜单...');
        } else if (choice === '4') {
            if (!hasAuthConfig()) {
                console.log('需要 deepseek-auth.json。请先运行选项 1 或 2。');
                continue;
            }
            return true;
        } else if (choice === '5') {
            return false;
        }
    }
}

async function main() {
    printBanner();
    const shouldStart = await showStartupMenu();
    if (!shouldStart) process.exit(0);
    server.listen(PORT, HOST, () => {
        console.log(`[DS-API] 服务器启动: http://${HOST}:${PORT}（多代理会话已启用）`);
        console.log(`[DS-API] ${formatWatermark()}`);
        console.log('[DS-API] POST /v1/chat/completions — OpenAI Chat Completions（stream=true|false）');
        console.log('[DS-API] POST /v1/messages — Anthropic Messages shim（用于 Claude Code）');
        console.log('[DS-API] POST /v1/responses — OpenAI Responses API shim');
        console.log('[DS-API] GET  /v1/models — 支持的 OpenAI 兼容模型列表');
        console.log('[DS-API] GET  /v1/model-capabilities — 真实模型映射和能力查询');
        console.log('[DS-API] GET  /v1/sessions — 活跃的代理会话列表');
        console.log('[DS-API] POST /reset-session?agent=<id> — 重置代理会话');
        console.log('[DS-API] POST /reset-session?agent=all — 重置所有会话');
    });
}

if (require.main === module) {
    main().catch(err => { console.error('[DS-API] 致命错误:', err); process.exit(1); });
}

module.exports = {
    __test: {
        isAssistantOutputFragment,
        isReasoningFragment,
        isDeepSeekModelErrorEvent,
        rebuildFragmentText,
        applyResponsePatchOperations,
        parseToolCall,
        shouldBootstrapSession,
        buildContinuePayload,
    },
};
