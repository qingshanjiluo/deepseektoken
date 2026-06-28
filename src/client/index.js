#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const API_BASE = process.env.FREE_DEEPSEEK_API_URL || 'http://localhost:9655';
const SESSION_FILE = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.free-deepseek-session.json');

let sessionId = null;
let agentId = null;
let showReasoning = false;
let currentModel = 'deepseek-chat';

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      sessionId = data.agentId;
      agentId = data.agentId;
    }
  } catch (e) {}
}

function saveSession() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ agentId: agentId || sessionId }, null, 2));
  } catch (e) {}
}

async function fetchApi(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (agentId) headers['x-agent-session'] = agentId;
  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}

async function showStatus() {
  try {
    const h = await fetch(`${API_BASE}/health`).then(r => r.json());
    console.log('\n服务状态:');
    console.log(`  账号: ${h.accounts?.length || 0}（就绪: ${(h.accounts || []).filter(a => a.ready).length}）`);
    console.log(`  活跃代理: ${h.agents || 0}`);
    console.log(`  配置就绪: ${h.config_ready ? '是' : '否'}`);

    const pa = await fetch(`${API_BASE}/admin/proxy-auth`).then(r => r.json());
    console.log(`  代理鉴权: ${pa.enabled ? '已启用' : '未启用'}`);

    const accts = await fetch(`${API_BASE}/admin/accounts`).then(r => r.json());
    if (accts && accts.length) {
      for (const a of accts) {
        const s = a.cooldown ? `冷却 ${a.cooldown_remaining_sec}s` : (a.ready ? '就绪' : '不可用');
        console.log(`  ${a.id}: ${s}`);
      }
    }
  } catch (e) { console.log('无法获取服务状态'); }
}

async function chatStream(prompt) {
  const payload = {
    model: currentModel,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  };

  const response = await fetchApi('/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error(`错误: ${error.error?.message || error.error || response.statusText}`);
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const data = JSON.parse(jsonStr);
          const delta = data.choices?.[0]?.delta;
          if (delta?.content) {
            process.stdout.write(delta.content);
            fullContent += delta.content;
          }
          if (showReasoning && delta?.reasoning_content) {
            process.stdout.write(`\n[思考] ${delta.reasoning_content}\n`);
          }
        } catch (e) {}
      }
    }
  }
  console.log();
  return fullContent;
}

async function showSessionInfo() {
  if (!agentId) { console.log('当前 agent: 未设置'); return; }
  try {
    const sessions = await fetchApi('/v1/sessions').then(r => r.json());
    const mine = (sessions?.agents || []).find(s => s.agent === agentId);
    if (mine) {
      console.log(`\n当前代理: ${agentId}`);
      console.log(`  会话ID: ${mine.session_id || '无'}`);
      console.log(`  消息数: ${mine.message_count}`);
      console.log(`  Bootstrap: ${mine.bootstrap_injected ? '已完成' : '未注入'}`);
      console.log(`  最后 finish: ${mine.last_finish_reason || '-'}`);
    } else {
      console.log(`当前代理 ${agentId} 无活跃会话`);
    }
  } catch (e) { console.log('无法获取会话信息'); }
}

async function resetSession() {
  if (!agentId) { console.log('请先设置 agent ID'); return; }
  await fetch(`${API_BASE}/reset-session?agent=${agentId}`, { method: 'POST' });
  console.log(`代理 ${agentId} 的会话已重置`);
}

async function interactive() {
  loadSession();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (!agentId) {
    agentId = 'cli-' + Math.random().toString(36).substring(2, 8);
    console.log(`自动分配 agent ID: ${agentId}`);
  } else {
    console.log(`使用 agent ID: ${agentId}`);
  }
  saveSession();

  console.log('命令: /agent <id>, /model <name>, /reasoning, /status, /session, /reset, /exit');
  console.log('直接输入问题即可聊天:');

  rl.on('line', async (input) => {
    input = input.trim();
    if (!input) return;

    if (input.startsWith('/')) {
      const parts = input.split(' ');
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case '/exit': case '/quit': rl.close(); return;
        case '/agent':
          if (arg) { agentId = arg; saveSession(); }
          console.log(`Agent: ${agentId}`);
          break;
        case '/model':
          if (arg) { currentModel = arg; }
          console.log(`模型: ${currentModel}`);
          break;
        case '/reasoning':
          showReasoning = !showReasoning;
          console.log(`推理显示: ${showReasoning ? '开' : '关'}`);
          break;
        case '/status':
          await showStatus();
          break;
        case '/session':
          await showSessionInfo();
          break;
        case '/reset':
          await resetSession();
          break;
        default:
          console.log(`未知命令: ${cmd}`);
      }
      rl.prompt();
      return;
    }

    console.log(`\n[${currentModel}]`);
    await chatStream(input);
    rl.prompt();
  });

  rl.prompt();
}

async function main() {
  loadSession();
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await interactive();
    return;
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) { currentModel = args[i + 1]; args.splice(i, 2); i--; }
    else if (args[i] === '--agent' && args[i + 1]) { agentId = args[i + 1]; args.splice(i, 2); i--; }
    else if (args[i] === '--reasoning') { showReasoning = true; args.splice(i, 1); i--; }
  }

  const prompt = args.join(' ');
  if (prompt) {
    console.log(`[${currentModel}]`);
    await chatStream(prompt);
  } else {
    await interactive();
  }
}

main().catch(e => { console.error(`错误: ${e.message}`); process.exit(1); });
