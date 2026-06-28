#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LANGS = require(path.join(ROOT, 'src', 'config', 'i18n'));
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m', magenta: '\x1b[35m' };

const LANG_NAMES = { zh: '\u4e2d\u6587', en: 'English', ru: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', ja: '\u65e5\u672c\u8a9e', ko: '\ud55c\uad6d\uc5b4' };
const LANG_FLAGS = { zh: '\ud83c\udde8\ud83c\uddf3', en: '\ud83c\uddec\ud83c\udde7', ru: '\ud83c\uddf7\ud83c\uddfa', ja: '\ud83c\uddef\ud83c\uddf5', ko: '\ud83c\uddf0\ud83c\uddf7' };
const LANG_ORDER = ['zh', 'en', 'ru', 'ja', 'ko'];

let L = null;

function t(key, vars = {}) {
  let val = (L && L[key]) || LANGS.en[key] || key;
  for (const [k, v] of Object.entries(vars)) val = val.replace(`{${k}}`, v);
  return val;
}

function printBox(title) { const w=56,pad=Math.max(0,w-title.length-4),l=Math.floor(pad/2),r=pad-l;console.log(C.cyan+'\u250c'+'\u2500'.repeat(w)+'\u2510'+C.reset);console.log(C.cyan+'\u2502'+' '.repeat(l)+C.bold+title+C.reset+C.cyan+' '.repeat(r)+'\u2502'+C.reset);console.log(C.cyan+'\u2514'+'\u2500'.repeat(w)+'\u2518'+C.reset); }
function divider(ch='\u2500',n=56) { console.log(C.dim+ch.repeat(n)+C.reset); }
function ok(msg) { console.log(`  ${C.green}\u2714${C.reset} ${msg}`); }
function warn(msg) { console.log(`  ${C.yellow}\u26a0${C.reset} ${msg}`); }
function err(msg) { console.log(`  ${C.red}\u2716${C.reset} ${msg}`); }
function info(msg) { console.log(`  ${C.blue}\u2139${C.reset} ${msg}`); }
function step(n, msg) { console.log(`\n${C.bold+C.cyan}[${n}]${C.reset} ${msg}`); }

function rl() { return readline.createInterface({ input: process.stdin, output: process.stdout }); }
function ask(msg, def) {
  const prompt = def ? `\n  ${msg} (${t('select')}: ${def}): ` : `\n  ${msg}: `;
  return new Promise(resolve => { const r = rl(); r.question(prompt, ans => { r.close(); resolve(ans.trim() || def); }); });
}
async function askChoice(msg, options) {
  console.log(`\n  ${C.bold}${msg}${C.reset}`);
  for (let i = 0; i < options.length; i++) console.log(`    ${C.green}${i+1}${C.reset} - ${options[i]}`);
  while (true) {
    const ans = await ask(t('choose'), '1');
    const num = parseInt(ans,10);
    if (num>=1 && num<=options.length) return num;
    console.log(`  ${C.red}${t('invalidChoice',{max:options.length})}${C.reset}`);
  }
}
async function askYesNo(msg, defNo=true) {
  const def = defNo ? 'n' : 'y';
  while (true) {
    const ans = (await ask(`${msg} (y = ${t('yes')} / n = ${t('no')})`, def)).toLowerCase();
    if (ans==='y'||ans==='yes') return true;
    if (ans==='n'||ans==='no') return false;
  }
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(path.join(ROOT,file),'utf8')); } catch { return null; } }
async function pause() { await ask(t('pressEnter')); }

const CONFIG_FILE = path.join(ROOT, '.wizard-lang.json');
function loadSavedLang() { try { const c=JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')); if (LANGS[c.lang]) return c.lang; } catch {} return null; }
function saveLang(lang) { fs.mkdirSync(path.dirname(CONFIG_FILE),{recursive:true}); fs.writeFileSync(CONFIG_FILE,JSON.stringify({lang}),'utf8'); }

async function main() {
  console.clear();

  // ---- language selection ----
  let lang = loadSavedLang();
  if (!lang || !process.env.SETUP_WIZARD_LANG) {
    console.log();
    for (let i = 0; i < LANG_ORDER.length; i++) {
      const code = LANG_ORDER[i];
      console.log(`  ${C.green}${i+1}${C.reset}  ${LANG_FLAGS[code]} ${LANG_NAMES[code]}${code===lang?C.dim+' (saved)':''}`);
    }
    console.log();
    const ans = await ask(t('choose'), lang ? String(LANG_ORDER.indexOf(lang)+1) : '1');
    const num = parseInt(ans,10);
    if (num>=1 && num<=LANG_ORDER.length) lang = LANG_ORDER[num-1];
    if (!lang) lang = 'en';

    if (!loadSavedLang() || loadSavedLang()!==lang) saveLang(lang);
    console.clear();
  }

  L = LANGS[lang] || LANGS.en;
  // allow per-run override via env
  if (process.env.SETUP_WIZARD_LANG && LANGS[process.env.SETUP_WIZARD_LANG]) L = LANGS[process.env.SETUP_WIZARD_LANG];

  printBox(t('title'));
  console.log(C.dim+'\n  '+t('desc')+C.reset);
  await pause();

  // ---- prereq ----
  step('1/5', t('stepPrereq'));
  divider();
  try { spawnSync('node',['--version'],{stdio:'ignore'}); } catch { err(t('nodeNotFound')); process.exit(1); }
  ok(t('nodeFound'));
  if (!fs.existsSync(path.join(ROOT,'node_modules'))) {
    warn(t('depsMissing')); console.log('  npm install...');
    const r=spawnSync('npm',['install'],{cwd:ROOT,stdio:'inherit',shell:true});
    if (r.status!==0) { err(t('depsFailed')); process.exit(1); }
    ok(t('depsInstalling'));
  } else { ok(t('depsOk')); }

  // ---- auth ----
  step('2/5', t('stepAuth'));
  divider();
  let auth = readJson('deepseek-auth.json');
  if (auth && auth.token && auth.cookie) {
    ok(t('authOk'));
    info(t('authTokenCookie',{tokenLen:auth.token.length,cookieLen:auth.cookie.split(';').length}));
    if (!(await askYesNo(t('authReconfig')))) { ok(t('authKeptAsIs')); } else { auth=null; }
  } else if (auth) { warn(t('authFileBroken')); auth=null; } else { warn(t('authMissing')); }
  if (!auth) {
    const m = await askChoice(t('authMethodTitle'), [t('authMethod1'),t('authMethod2'),t('authMethod3')]);
    if (m===1) {
      console.log(`\n  ${C.yellow}${t('chromeLaunching')}${C.reset}`);
      console.log(`  ${C.dim}${t('chromeStep1')}${C.reset}`);
      console.log(`  ${C.dim}${t('chromeStep2')}${C.reset}`);
      console.log(`  ${C.dim}${t('chromeStep3')}${C.reset}`);
      await pause();
      spawnSync('node',[path.join(__dirname,'deepseek_chrome_auth.js')],{cwd:ROOT,stdio:'inherit',env:process.env});
      auth=readJson('deepseek-auth.json');
      auth&&auth.token&&auth.cookie ? ok(t('authConfigured')) : warn(t('authIncomplete'));
    } else if (m===2) {
      spawnSync('node',[path.join(__dirname,'auth_import.js')],{cwd:ROOT,stdio:'inherit',env:process.env});
      auth=readJson('deepseek-auth.json');
      auth&&auth.token&&auth.cookie ? ok(t('authImported')) : warn(t('importIncomplete'));
    } else { warn(t('authSkipped')); }
  }

  // ---- connection ----
  if (auth && auth.token && auth.cookie) {
    step('3/5', t('stepConnection'));
    divider();
    console.log(`  ${t('testingConnect')}`);
    try {
      const headers={'User-Agent':'Mozilla/5.0','x-client-platform':'web','x-client-version':'2.0.0','x-client-locale':'zh_CN','x-client-timezone-offset':'28800','x-app-version':'2.0.0','Authorization':`Bearer ${auth.token}`,'x-hif-dliq':auth.hif_dliq||'','x-hif-leim':auth.hif_leim||'','Origin':'https://chat.deepseek.com','Referer':'https://chat.deepseek.com/','Cookie':auth.cookie||'','Content-Type':'application/json'};
      const resp=await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge',{method:'POST',headers,body:JSON.stringify({target_path:'/api/v0/chat/completion'})});
      resp.ok ? ok(t('apiReachable')) : warn(t('apiUnreachableStatus',{status:resp.status}));
    } catch(e) { warn(t('apiUnreachableError',{error:e.message})); warn(t('checkNetwork')); }
  }

  // ---- proxy auth ----
  step('4/5', t('stepProxyAuth'));
  divider();
  const proxyAuthFile = path.join(ROOT,'proxy-auth.json');
  let pa = null; try { pa=require(proxyAuthFile); } catch {}
  if (pa && pa.enabled) {
    ok(t('proxyAuthEnabled'));
    info(t('proxyApiKeys',{keys:(pa.apiKeys||[]).length,bearers:(pa.bearerTokens||[]).length}));
    if (!(await askYesNo(t('proxyRegen')))) { ok(t('proxyKeptAsIs')); } else { pa=null; }
  } else {
    console.log(`  ${C.dim}${t('proxyDisabled')}${C.reset}`);
    console.log(`  ${C.dim}${t('proxyEnableHint')}${C.reset}`);
  }
  if (!pa || !pa.enabled) {
    if (await askYesNo(t('proxyEnable'),true)) {
      const { ProxyKeyStore } = require(path.join(ROOT,'src','auth','proxyKeyStore'));
      const s=new ProxyKeyStore({filePath:proxyAuthFile}); s.load(); s.setEnabled(true);
      const ak=s.generateApiKey(); s.addApiKey(ak);
      const bt=s.generateBearerToken(); s.addBearerToken(bt); s.save();
      ok(t('proxyGeneratedOk'));
      divider('\u2500',48);
      console.log(`\n  ${C.bold}${t('credentialsSave')}${C.reset}\n`);
      console.log(`  ${C.green}${t('xApiKeyHeader')}${C.reset}\n  ${C.yellow}${ak}${C.reset}\n`);
      console.log(`  ${C.green}${t('authHeader')}${C.reset}\n  ${C.yellow}Bearer ${bt}${C.reset}\n`);
      console.log(`  ${C.dim}${t('credentialsExample')}${C.reset}`);
      console.log(`  ${C.dim}curl -H "x-api-key: ${ak}" http://localhost:9655/v1/chat/completions${C.reset}`);
      divider('\u2500',48);
    }
  }

  // ---- injection ----
  const inj = process.env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED !== '0';
  console.log(`\n  ${(inj?C.green:C.yellow)}${inj?t('bootstrapOn'):t('bootstrapOff')}${C.reset}`);
  console.log(`  ${C.dim}${t('bootstrapDesc')}${C.reset}`);
  if (inj && (await askYesNo(t('disableBootstrap'),true))) console.log(`  ${C.yellow}${t('bootstrapTip')}${C.reset}`);

  // ---- summary ----
  step('5/5', t('stepSummary'));
  divider();
  console.log(`\n  ${C.bold}${t('summaryTitle')}${C.reset}\n`);
  auth=readJson('deepseek-auth.json');
  (auth&&auth.token&&auth.cookie) ? ok(`${t('authReady')} : ${C.green}${t('authStatusReady')}${C.reset}`) : err(`${t('authReady')} : ${C.red}${t('authStatusMissing')}${C.reset}`);
  try { pa=require(proxyAuthFile); } catch { pa=null; }
  (pa&&pa.enabled) ? ok(`${t('proxyReady')} : ${C.green}${t('proxyStatusEnabled')}${C.reset} (${(pa.apiKeys||[]).length} keys)`) : warn(`${t('proxyReady')} : ${C.yellow}${t('proxyStatusDisabled')}${C.reset}`);

  console.log(`\n  ${C.bold}${t('quickStart')}${C.reset}`);
  console.log(`  node server.js`);
  console.log(`  ${C.dim}or double-click startup.bat${C.reset}\n`);
  divider();

  if (await askYesNo(t('startNow'),false)) {
    console.log(`\n${C.cyan}${t('starting')}${C.reset}\n`);
    spawnSync('node',['server.js'],{cwd:ROOT,stdio:'inherit',env:{...process.env,NON_INTERACTIVE:'1'}});
  } else {
    console.log(`\n${C.dim}${t('startLater')} node server.js${C.reset}\n`);
  }
}

main().catch(e => { console.error(`${C.red}${LANGS.en.error||'Error'}:${C.reset}`,e.message); process.exit(1); });
