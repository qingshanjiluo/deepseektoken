#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const AUTH_PATH = process.env.DEEPSEEK_AUTH_PATH || path.join(ROOT, 'deepseek-auth.json');
const PROFILE_DIR = process.env.DEEPSEEK_CHROME_PROFILE || path.join(ROOT, '.chrome-for-testing-profile-deepseek');
const WATERMARK = 't.me/forgetmeai';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}
function divider() { console.log('======================================================'); }
function watermark(prefix = 'ForgetMeAI') { return `${prefix}: ${WATERMARK}`; }
function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')); }
  catch { return null; }
}
function status() {
  const auth = loadAuth();
  console.log('\nDeepSeek 账号:');
  if (!auth) {
    console.log('  ❌ deepseek-auth.json 未找到');
  } else {
    console.log(`  ✅ 认证文件: ${AUTH_PATH}`);
    console.log(`  token: ${auth.token ? 'OK (' + String(auth.token).length + ' 字符)' : '缺失'}`);
    console.log(`  cookies: ${auth.cookie ? 'OK' : '缺失'}`);
    console.log(`  Chrome 配置: ${fs.existsSync(PROFILE_DIR) ? PROFILE_DIR : '未找到'}`);
  }
}
function runDirectAuth() {
  const script = path.join(__dirname, 'deepseek_chrome_auth.js');
  return spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env }).status === 0;
}
function runImportAuth() {
  const script = path.join(__dirname, 'auth_import.js');
  return spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env }).status === 0;
}
function removeLocalAuth() {
  if (fs.existsSync(AUTH_PATH)) fs.rmSync(AUTH_PATH, { force: true });
  console.log('已删除 deepseek-auth.json。Chrome 配置保留，避免不必要地退出浏览器登录。');
}
function printHelp() {
  divider();
  console.log('FreeDeepseekAPI — DeepSeek Web 登录管理');
  console.log(watermark());
  divider();
  console.log('选项:');
  console.log('  --login     打开 Chrome 并更新认证');
  console.log('  --import    导入已有的 deepseek-auth.json / browser cookies');
  console.log('  --status    显示认证状态');
  console.log('  --remove    删除本地 deepseek-auth.json');
  console.log('  --help      帮助');
  console.log('无选项时启动交互菜单。');
  divider();
}
async function menu() {
  while (true) {
    divider();
    console.log(watermark());
    status();
    divider();
    console.log('菜单:');
    console.log('1 - 授权 / 更新 DeepSeek 登录');
    console.log('2 - 导入认证文件 / cookies');
    console.log('3 - 显示状态');
    console.log('4 - 删除本地认证文件');
    console.log('5 - 代理鉴权管理');
    console.log('6 - 退出');
    const choice = (await prompt('请选择（回车 = 6）: ')) || '6';
    if (choice === '1') runDirectAuth();
    else if (choice === '2') runImportAuth();
    else if (choice === '3') { status(); await prompt('\n按 Enter 返回菜单...'); }
    else if (choice === '4') removeLocalAuth();
    else if (choice === '5') {
        const ROOT = path.resolve(__dirname, '..');
        const { ProxyKeyStore } = require(path.join(ROOT, 'src', 'auth', 'proxyKeyStore'));
        const paPath = process.env.PROXY_AUTH_PATH || path.join(ROOT, 'proxy-auth.json');
        const pa = new ProxyKeyStore({ filePath: paPath });
        pa.load();
        while (true) {
            console.log('\n代理鉴权:');
            console.log(JSON.stringify(pa.getConfig(), null, 2));
            console.log('e-启用, d-禁用, k-生成 API Key, t-生成 Bearer, r-返回');
            const sub = (await prompt('操作: ')) || 'r';
            if (sub === 'e') { pa.setEnabled(true); pa.save(); console.log('已启用'); }
            else if (sub === 'd') { pa.setEnabled(false); pa.save(); console.log('已禁用'); }
            else if (sub === 'k') { const k = pa.generateApiKey(); pa.addApiKey(k); pa.save(); console.log(`Key: ${k}`); }
            else if (sub === 't') { const t = pa.generateBearerToken(); pa.addBearerToken(t); pa.save(); console.log(`Token: ${t}`); }
            else break;
        }
    }
    else if (choice === '6') break;
  }
}
(async () => {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) return printHelp();
  if (args.has('--login') || args.has('--add') || args.has('--relogin')) return void runDirectAuth();
  if (args.has('--import')) return void runImportAuth();
  if (args.has('--status') || args.has('--list')) return status();
  if (args.has('--remove')) return removeLocalAuth();
  await menu();
})();
