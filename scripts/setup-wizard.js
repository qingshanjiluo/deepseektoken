#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LANGS = require(path.join(ROOT, 'src', 'config', 'i18n'));
const WI18N = require(path.join(ROOT, 'src', 'config', 'i18n-wizard'));
const { INJECTION_PRESETS } = require(path.join(ROOT, 'src', 'config', 'proxy-defaults'));
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m', magenta: '\x1b[35m', white: '\x1b[37m' };

const LANG_NAMES = { zh: '\u4e2d\u6587', en: 'English', ru: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', ja: '\u65e5\u672c\u8a9e', ko: '\ud55c\uad6d\uc5b4' };
const LANG_FLAGS = { zh: '\ud83c\udde8\ud83c\uddf3', en: '\ud83c\uddec\ud83c\udde7', ru: '\ud83c\uddf7\ud83c\uddfa', ja: '\ud83c\uddef\ud83c\uddf5', ko: '\ud83c\uddf0\ud83c\uddf7' };
const LANG_ORDER = ['zh', 'en', 'ru', 'ja', 'ko'];

const INJECTION_FILE = path.join(ROOT, '.injection-prompt.txt');

let L = null, W = null;

function wt(key, vars = {}) {
  let val = (W && W[key]) || (WI18N.en && WI18N.en[key]) || key;
  for (const [k, v] of Object.entries(vars)) val = val.replace(`{${k}}`, v);
  return val;
}
function t(key, vars = {}) {
  let val = (L && L[key]) || LANGS.en[key] || key;
  for (const [k, v] of Object.entries(vars)) val = val.replace(`{${k}}`, v);
  return val;
}

// ---- UI helpers ----
function clr() { try { console.clear(); } catch {} }
function box(title, color) { const c=color||C.cyan,w=56,pad=Math.max(0,w-title.length-4),l=Math.floor(pad/2),r=pad-l;console.log(c+'\u250c'+'\u2500'.repeat(w)+'\u2510'+C.reset);console.log(c+'\u2502'+' '.repeat(l)+C.bold+title+C.reset+c+' '.repeat(r)+'\u2502'+C.reset);console.log(c+'\u2514'+'\u2500'.repeat(w)+'\u2518'+C.reset); }
function divider(ch,n) { console.log(C.dim+(ch||'\u2500').repeat(n||56)+C.reset); }
function ok(msg) { console.log(`  ${C.green}\u2714${C.reset} ${msg}`); }
function warn(msg) { console.log(`  ${C.yellow}\u26a0${C.reset} ${msg}`); }
function err(msg) { console.log(`  ${C.red}\u2716${C.reset} ${msg}`); }
function info(msg) { console.log(`  ${C.blue}\u2139${C.reset} ${msg}`); }
function hdr(n, msg, badge) {
  const total = typeof n === 'number' ? `/${n}` : '';
  console.log(`\n${C.bold+C.cyan}\u2502${C.reset}  ${C.bold}${msg}${C.reset}${badge?'  '+badge:''}`);
  divider();
}
function cardItem(label, value, color) {
  const c = color || C.white;
  console.log(`  ${C.dim}${label}:${C.reset} ${c}${value}${C.reset}`);
}

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
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= options.length) return num;
    console.log(`  ${C.red}${t('invalidChoice', {max: options.length})}${C.reset}`);
  }
}
async function askYesNo(msg, defNo) {
  const def = (defNo !== false) ? 'n' : 'y';
  while (true) {
    const ans = (await ask(`${msg} (y = ${t('yes')} / n = ${t('no')})`, def)).toLowerCase();
    if (ans === 'y' || ans === 'yes') return true;
    if (ans === 'n' || ans === 'no') return false;
  }
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch { return null; } }
async function pause() { await ask(t('pressEnter')); }

// ---- config helpers ----
function getInjectionPrompt() {
  try { const v = fs.readFileSync(INJECTION_FILE, 'utf8').trim(); if (v) return v; } catch {}
  return null;
}
function saveInjectionPrompt(text) { fs.writeFileSync(INJECTION_FILE, text, 'utf8'); }
function getAccountSwapEnabled() {
  try { const c = JSON.parse(fs.readFileSync(path.join(ROOT, '.wizard-config.json'), 'utf8')); return c.accountSwapEnabled === true; } catch { return false; }
}
function saveAccountSwapEnabled(enabled) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.wizard-config.json'), 'utf8')); } catch {}
  cfg.accountSwapEnabled = enabled;
  // Also set env-compatible flag
  if (enabled) process.env.DEEPSEEK_ACCOUNT_SWAP_ENABLED = '1';
  else delete process.env.DEEPSEEK_ACCOUNT_SWAP_ENABLED;
  fs.writeFileSync(path.join(ROOT, '.wizard-config.json'), JSON.stringify(cfg, null, 2));
}

// ---- multi-account helpers ----
function getAccountsDir() { return process.env.DEEPSEEK_AUTH_DIR || path.join(ROOT, 'accounts'); }
function scanAccounts() {
  const result = [];
  const single = readJson('deepseek-auth.json');
  if (single) {
    if (Array.isArray(single)) result.push(...single.map((a,i)=>({...a,_file:'deepseek-auth.json',_idx:i})));
    else result.push({...single,_file:'deepseek-auth.json',_idx:0});
  }
  const dir = getAccountsDir();
  if (!Array.isArray(single) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    for (const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json')).sort()) {
      const a = readJson(path.relative(ROOT,path.join(dir,f)));
      if (a && a.token) result.push({...a,_file:path.relative(ROOT,path.join(dir,f)),_idx:-1});
    }
  }
  return result;
}
function accountDisplayName(acc, idx) { const n=acc._file?path.basename(acc._file):`account_${idx+1}`; const s=acc.token&&acc.cookie?'OK':'INCOMPLETE'; return `${n} | token:${s}`; }
function saveSingleFile(accounts) {
  const arr=accounts.map(a=>{const{_file,_idx,...r}=a;return r;});
  fs.writeFileSync(path.join(ROOT,'deepseek-auth.json'),JSON.stringify(arr.length===1?arr[0]:arr,null,2));
}
function saveDirMode(accounts) {
  const dir=getAccountsDir();
  if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});ok(wt('multiAccountDirCreated'));}
  for(const f of fs.readdirSync(dir)){if(f.endsWith('.json'))fs.unlinkSync(path.join(dir,f));}
  for(let i=0;i<accounts.length;i++){const{_file,_idx,...r}=accounts[i];fs.writeFileSync(path.join(dir,`account_${String(i+1).padStart(2,'0')}.json`),JSON.stringify(r,null,2));}
  process.env.DEEPSEEK_AUTH_DIR=dir;
  if(fs.existsSync(path.join(ROOT,'deepseek-auth.json')))fs.unlinkSync(path.join(ROOT,'deepseek-auth.json'));
}

// ---- language ----
const CONFIG_FILE = path.join(ROOT, '.wizard-lang.json');
function loadSavedLang() { try { const c=JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')); if(LANGS[c.lang]) return c.lang; } catch{} return null; }
function saveLang(lang) { fs.mkdirSync(path.dirname(CONFIG_FILE),{recursive:true}); fs.writeFileSync(CONFIG_FILE,JSON.stringify({lang}),'utf8'); }

// =====================================================================
async function main() {
  clr();

  // ---- language ----
  let lang = loadSavedLang();
  if (!lang || !process.env.SETUP_WIZARD_LANG) {
    console.log();
    for (let i=0;i<LANG_ORDER.length;i++) {
      const code=LANG_ORDER[i];
      console.log(`  ${C.green}${i+1}${C.reset}  ${LANG_FLAGS[code]} ${LANG_NAMES[code]}${code===lang?C.dim+' (saved)':''}`);
    }
    console.log();
    const ans=await ask('Choose language',lang?String(LANG_ORDER.indexOf(lang)+1):'1');
    const num=parseInt(ans,10);
    if(num>=1&&num<=LANG_ORDER.length)lang=LANG_ORDER[num-1];
    if(!lang)lang='en';
    if(!loadSavedLang()||loadSavedLang()!==lang)saveLang(lang);
    clr();
  }
  L=LANGS[lang]||LANGS.en;
  W=WI18N[lang]||WI18N.en;

  box(t('title'));
  console.log(C.dim+'\n  '+t('desc')+C.reset);
  await pause();

  // ---- prereq ----
  hdr(0, t('stepPrereq'));
  try{spawnSync('node',['--version'],{stdio:'ignore'});}catch{err(t('nodeNotFound'));process.exit(1);}
  ok(t('nodeFound'));
  if(!fs.existsSync(path.join(ROOT,'node_modules'))){
    warn(t('depsMissing'));console.log('  npm install...');
    const r=spawnSync('npm',['install'],{cwd:ROOT,stdio:'inherit',shell:true});
    if(r.status!==0){err(t('depsFailed'));process.exit(1);}
    ok(t('depsInstalling'));
  }else{ok(t('depsOk'));}

  // ============== WELCOME & CONFIG DETECTION ==============
  const accts=scanAccounts();
  const acctsReady=accts.filter(a=>a.token&&a.cookie).length;
  const paFile=path.join(ROOT,'proxy-auth.json');
  let pa=null;try{pa=require(paFile);}catch{}
  const inj=getInjectionPrompt()||process.env.DEEPSEEK_DEFAULT_INJECTION_PROMPT||'';
  const injOn=process.env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED!=='0'||!!getInjectionPrompt();
  const swapOn=getAccountSwapEnabled();

  const hasExisting=accts.length>0||(pa&&pa.enabled)||injOn||swapOn;

  console.log();
  if(hasExisting){
    box(wt('welcome'),C.green);
  }else{
    box(wt('welcomeFresh'),C.cyan);
  }
  console.log(`\n  ${C.bold}${wt('welcomeCardTitle')}${C.reset}\n`);
  cardItem(wt('welcomeCardAccts'), accts.length>0?wt('welcomeCardAcctsFull',{count:accts.length,ready:acctsReady}):wt('welcomeCardAcctsNone'), accts.length>0?C.green:C.yellow);
  cardItem(wt('welcomeCardProxy'), (pa&&pa.enabled)?wt('welcomeCardProxyOn',{keys:(pa.apiKeys||[]).length,bearers:(pa.bearerTokens||[]).length}):wt('welcomeCardProxyOff'), (pa&&pa.enabled)?C.green:C.yellow);
  cardItem(wt('welcomeCardInject'), injOn?wt('welcomeCardInjectOn',{chars:inj.length}):wt('welcomeCardInjectOff'), injOn?C.green:C.yellow);
  cardItem(wt('welcomeCardSwap'), swapOn?wt('welcomeCardSwapOn'):wt('welcomeCardSwapOff'), swapOn?C.green:C.yellow);
  console.log();

  // ---- decide flow ----
  let flow='all';
  if(hasExisting){
    const welcomeChoice=await askChoice('',[wt('welcomeActionContinue'),wt('welcomeActionFresh'),wt('welcomeActionPick')]);
    if(welcomeChoice===1)flow='continue';
    else if(welcomeChoice===2)flow='all';
    else if(welcomeChoice===3)flow='pick';
  }

  // ---- pick specific modules ----
  let runAccts=false,runProxy=false,runInject=false,runSwap=false;
  if(flow==='continue'){
    runAccts=false;runProxy=false;runInject=false;runSwap=false;
  }else if(flow==='pick'){
    clr();box(t('title'));
    const picks=await askChoice(wt('welcomePickTitle'),[wt('welcomePickAccts'),wt('welcomePickProxy'),wt('welcomePickInject'),wt('welcomePickSwap'),wt('welcomePickAll')]);
    if(picks===1)runAccts=true;
    else if(picks===2)runProxy=true;
    else if(picks===3)runInject=true;
    else if(picks===4)runSwap=true;
    else if(picks===5){runAccts=true;runProxy=true;runInject=true;runSwap=true;}
  }else{
    runAccts=true;runProxy=true;runInject=true;runSwap=true;
  }

  // ============== SECTION: ACCOUNTS ==============
  if(runAccts){
    hdr(0, wt('stepAccts'), acctsReady?`${C.green}${acctsReady}/${accts.length} ready`+C.reset:null);
    let dirty=false;
    while(true){
      let cur=scanAccounts();
      const cnt=cur.length;
      console.log();
      if(cnt>0){ ok(wt('multiAccountCount',{count:cnt})); console.log(`  ${C.dim}${wt('multiAccountList')}${C.reset}`);
        for(let i=0;i<cnt;i++){ const s=cur[i].token&&cur[i].cookie?C.green+'OK'+C.reset:C.yellow+'MISSING'+C.reset;console.log(`    ${i+1}. ${accountDisplayName(cur[i],i)} [${s}]`); }
      }else{ warn(t('authMissing')); }
      const mode=Array.isArray(readJson('deepseek-auth.json'))?t('multiAccountModeSingle'):t('multiAccountModeSingle');
      info(t('multiAccountMode',{mode}));
      const opts=[t('multiAccountAddLogin'),t('multiAccountAddImport'),t('multiAccountAddManual')];
      if(cnt>0)opts.push(t('multiAccountRemove'));
      opts.push(wt('sectionSkip'));
      const m=await askChoice(t('multiAccountTitle'),opts);
      if(m===1){ console.log(`\n  ${C.yellow}${t('chromeLaunching')}${C.reset}`);console.log(`  ${C.dim}${t('chromeStep1')}${C.reset}`);console.log(`  ${C.dim}${t('chromeStep2')}${C.reset}`);console.log(`  ${C.dim}${t('chromeStep3')}${C.reset}`);await pause();spawnSync('node',[path.join(__dirname,'deepseek_chrome_auth.js')],{cwd:ROOT,stdio:'inherit',env:process.env});dirty=true; }
      else if(m===2){spawnSync('node',[path.join(__dirname,'auth_import.js')],{cwd:ROOT,stdio:'inherit',env:process.env});dirty=true;}
      else if(m===3){ const tok=await ask(t('multiAccountManualToken'));const ck=await ask(t('multiAccountManualCookie'));if(tok&&ck){const ex=scanAccounts();const na={token:tok,cookie:ck,hif_dliq:'',hif_leim:'',wasmUrl:'https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm'};ex.push(na);if(ex.length===1){saveSingleFile(ex);ok(wt('multiAccountManualSaved',{file:'deepseek-auth.json'}));}else{if(await askYesNo(t('multiAccountSwitchMode'))){saveDirMode(ex);}else{saveSingleFile(ex);ok(wt('multiAccountManualSaved',{file:'deepseek-auth.json'}));}}dirty=true;} }
      else if(m===4&&cnt>0){ const rmIdx=parseInt(await ask(t('multiAccountRemovePrompt'),'0'),10);if(rmIdx>=1&&rmIdx<=cnt){const ex=scanAccounts();ex.splice(rmIdx-1,1);if(ex.length===0){if(fs.existsSync(path.join(ROOT,'deepseek-auth.json')))fs.unlinkSync(path.join(ROOT,'deepseek-auth.json'));}else{const d=getAccountsDir();if(fs.existsSync(d)&&fs.readdirSync(d).some(f=>f.endsWith('.json'))){saveDirMode(ex);}else{saveSingleFile(ex);}}ok(wt('multiAccountRemoveDone',{id:'#'+rmIdx}));dirty=true;} }
      else break;
    }
  }

  // ---- connection test ----
  let auth=readJson('deepseek-auth.json');
  if(!auth||!auth.token)auth=null;
  if(!auth){const ac=scanAccounts();if(ac.length>0&&ac[0].token&&ac[0].cookie)auth=ac[0];}
  if(auth&&auth.token&&auth.cookie){
    hdr(0,t('stepConnection'));
    console.log(`  ${t('testingConnect')}`);
    try{
      const h={'User-Agent':'Mozilla/5.0','x-client-platform':'web','x-client-version':'2.0.0','x-client-locale':'zh_CN','x-client-timezone-offset':'28800','x-app-version':'2.0.0','Authorization':`Bearer ${auth.token}`,'x-hif-dliq':auth.hif_dliq||'','x-hif-leim':auth.hif_leim||'','Origin':'https://chat.deepseek.com','Referer':'https://chat.deepseek.com/','Cookie':auth.cookie||'','Content-Type':'application/json'};
      const resp=await fetch('https://chat.deepseek.com/api/v0/chat/create_pow_challenge',{method:'POST',headers:h,body:JSON.stringify({target_path:'/api/v0/chat/completion'})});
      resp.ok?ok(t('apiReachable')):warn(t('apiUnreachableStatus',{status:resp.status}));
    }catch(e){warn(t('apiUnreachableError',{error:e.message}));warn(t('checkNetwork'));}
  }

  // ============== SECTION: PROXY AUTH ==============
  if(runProxy){
    const proxyLabel = (paena,keys,bears) => paena ? C.green + wt('welcomeCardProxyOn', {keys,bears}) + C.reset : C.yellow + wt('welcomeCardProxyOff') + C.reset;
    try{pa=require(paFile);}catch{pa=null;}
    const initialEnabled = pa && pa.enabled;

    while(true){
      try{pa=require(paFile);}catch{pa=null;}
      const paEnabled = pa && pa.enabled;
      const paKeys = (pa && pa.apiKeys) || [];
      const paTokens = (pa && pa.bearerTokens) || [];
      hdr(0, wt('stepProxy'), proxyLabel(paEnabled,paKeys.length,paTokens.length));
      console.log();

      if(paEnabled){
        if(paKeys.length>0){ console.log(`  ${C.dim}${wt('proxyKeyList')}${C.reset}`); for(let i=0;i<paKeys.length;i++) console.log(`    ${i+1}. ${C.yellow}${paKeys[i]}${C.reset}`); console.log(); }
        if(paTokens.length>0){ console.log(`  ${C.dim}${wt('proxyTokenList')}${C.reset}`); for(let i=0;i<paTokens.length;i++) console.log(`    ${i+1}. ${C.yellow}${paTokens[i]}${C.reset}`); console.log(); }
        ok(t('proxyAuthEnabled'));
        const paOpts=[wt('proxyAddKey'),wt('proxyAddToken')];
        if(paKeys.length>0)paOpts.unshift(wt('proxyRemoveKey'));
        if(paTokens.length>0)paOpts.push(wt('proxyRemoveToken'));
        paOpts.push(wt('proxyDisable'));
        paOpts.push(wt('sectionSkip'));
        const paM=await askChoice('',paOpts);
        const {ProxyKeyStore}=require(path.join(ROOT,'src','auth','proxyKeyStore'));
        const s=new ProxyKeyStore({filePath:paFile});s.load();
        if(paOpts.indexOf(wt('proxyRemoveKey'))===0&&paM===1){
          const rmIdx=parseInt(await ask(wt('proxyRemoveByIdx'),'0'),10);
          if(rmIdx>=1&&rmIdx<=paKeys.length){s.removeApiKey(paKeys[rmIdx-1]);s.save();ok(`${wt('proxyRemoveSelect')} #${rmIdx}`);}
        }else if((paOpts.indexOf(wt('proxyAddKey'))===0||paOpts.indexOf(wt('proxyAddKey'))===1)&&paM===paOpts.indexOf(wt('proxyAddKey'))+1){
          const ak=s.generateApiKey();s.addApiKey(ak);s.save();ok(wt('proxyAddKey'));console.log(`\n  ${C.yellow}${ak}${C.reset}\n`);
        }else if(paM===paOpts.indexOf(wt('proxyAddToken'))+1){
          const bt=s.generateBearerToken();s.addBearerToken(bt);s.save();ok(wt('proxyAddToken'));console.log(`\n  ${C.yellow}${bt}${C.reset}\n`);
        }else if(paM===paOpts.indexOf(wt('proxyRemoveToken'))+1){
          const rmIdx=parseInt(await ask(wt('proxyRemoveByIdx'),'0'),10);
          if(rmIdx>=1&&rmIdx<=paTokens.length){s.removeBearerToken(paTokens[rmIdx-1]);s.save();ok(`${wt('proxyRemoveSelect')} #${rmIdx}`);}
        }else if(paM===paOpts.indexOf(wt('proxyDisable'))+1){
          if(await askYesNo('',true)){s.setEnabled(false);s.save();ok(wt('proxyDisabledNow'));}
        }else{break;}
      }else{
        warn(t('proxyDisabled'));
        if(!initialEnabled){
          const enableChoice=await askChoice('',[wt('proxyEnableTitle'),wt('proxyAddKey')+' + '+wt('proxyAddToken'),wt('sectionSkip')]);
          if(enableChoice===1){
            try{pa=require(paFile);}catch{pa=null;}
            const exKeys=(pa&&pa.apiKeys)||[];const exTokens=(pa&&pa.bearerTokens)||[];
            if(exKeys.length>0||exTokens.length>0){
              if(await askYesNo('',false)){
                const {ProxyKeyStore}=require(path.join(ROOT,'src','auth','proxyKeyStore'));
                const s=new ProxyKeyStore({filePath:paFile});s.load();s.setEnabled(true);s.save();
                ok(`${wt('proxyEnableTitle')} (${exKeys.length} keys, ${exTokens.length} tokens)`);
              }
            }else{
              const {ProxyKeyStore}=require(path.join(ROOT,'src','auth','proxyKeyStore'));
              const s=new ProxyKeyStore({filePath:paFile});s.load();s.setEnabled(true);
              const ak=s.generateApiKey();s.addApiKey(ak);const bt=s.generateBearerToken();s.addBearerToken(bt);s.save();
              ok(t('proxyGeneratedOk'));divider('\u2500',48);
              console.log(`\n  ${C.bold}${t('credentialsSave')}${C.reset}\n`);
              console.log(`  ${C.green}${t('xApiKeyHeader')}${C.reset}\n  ${C.yellow}${ak}${C.reset}\n`);
              console.log(`  ${C.green}${t('authHeader')}${C.reset}\n  ${C.yellow}Bearer ${bt}${C.reset}\n`);
              divider('\u2500',48);
            }
          }else if(enableChoice===2){
            const {ProxyKeyStore}=require(path.join(ROOT,'src','auth','proxyKeyStore'));
            const s=new ProxyKeyStore({filePath:paFile});s.load();s.setEnabled(true);
            const ak=s.generateApiKey();s.addApiKey(ak);const bt=s.generateBearerToken();s.addBearerToken(bt);s.save();
            ok(t('proxyGeneratedOk'));divider('\u2500',48);
            console.log(`\n  ${C.bold}${t('credentialsSave')}${C.reset}\n`);
            console.log(`  ${C.green}${t('xApiKeyHeader')}${C.reset}\n  ${C.yellow}${ak}${C.reset}\n`);
            console.log(`  ${C.green}${t('authHeader')}${C.reset}\n  ${C.yellow}Bearer ${bt}${C.reset}\n`);
            divider('\u2500',48);
          }else{break;}
        }else{
          // Was enabled, user disabled it - offer to re-enable or keep off
          try{pa=require(paFile);}catch{pa=null;}
          const exKeys=(pa&&pa.apiKeys)||[];const exTokens=(pa&&pa.bearerTokens)||[];
          const reenableChoice=await askChoice('',[wt('proxyEnableTitle'),wt('proxyKeepDisabled')]);
          if(reenableChoice===1){
            const {ProxyKeyStore}=require(path.join(ROOT,'src','auth','proxyKeyStore'));
            const s=new ProxyKeyStore({filePath:paFile});s.load();s.setEnabled(true);s.save();
            ok(wt('welcomeCardProxyOn',{keys:exKeys.length,bearers:exTokens.length}));
          }
          break;
        }
      }
    }
  }

  // ============== SECTION: INJECTION ==============
  if(runInject){
    const curInj=getInjectionPrompt()||process.env.DEEPSEEK_DEFAULT_INJECTION_PROMPT||'';
    const curEnabled=process.env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED!=='0'||!!getInjectionPrompt();
    const badge=curEnabled?C.green+wt('welcomeCardInjectOn',{chars:curInj.length})+C.reset:C.yellow+wt('welcomeCardInjectOff')+C.reset;
    hdr(0,wt('stepInject'),badge);
    console.log(`  ${C.dim}${wt('injectDesc')}${C.reset}`);
    if(curEnabled&&curInj){
      console.log(`\n  ${C.dim}${wt('injectPreview',{chars:curInj.length})}${C.reset}\n  ${C.white}${curInj.length>200?curInj.substring(0,200)+'...':curInj}${C.reset}`);
    }

    // ---- preset selection ----
    console.log();
    const presetChoice=await askChoice(wt('injectPresets'),[
      wt('injectPresetTool'),
      wt('injectPresetStrict'),
      wt('injectPresetSimple'),
      wt('injectPresetCreative'),
      wt('injectPresetCustom'),
    ]);
    if(presetChoice===1){
      saveInjectionPrompt(INJECTION_PRESETS.tool);ok(wt('injectSaved'));
    }else if(presetChoice===2){
      saveInjectionPrompt(INJECTION_PRESETS.strict);ok(wt('injectSaved'));
    }else if(presetChoice===3){
      saveInjectionPrompt(INJECTION_PRESETS.simple);ok(wt('injectSaved'));
    }else if(presetChoice===4){
      saveInjectionPrompt(INJECTION_PRESETS.creative);ok(wt('injectSaved'));
    }else if(presetChoice===5){
      const newInj=await ask(wt('injectEnter'));
      if(newInj){saveInjectionPrompt(newInj);ok(wt('injectSaved'));}
    }

    if(!curEnabled){
      if(await askYesNo(wt('injectEnable'),false)){
        process.env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED='1';
        const saved=getInjectionPrompt();
        if(!saved&&curInj)saveInjectionPrompt(curInj);
        ok(wt('welcomeCardInjectOn',{chars:(saved||curInj||'').length}));
      }
    }else{
      if(await askYesNo(t('disableBootstrap'),true)){
        process.env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED='0';
        ok(wt('welcomeCardInjectOff'));
      }
    }
  }

  // ============== SECTION: ACCOUNT SWITCHING ==============
  if(runSwap){
    const curSwap=getAccountSwapEnabled();
    hdr(0,wt('stepSwap'),curSwap?C.green+wt('welcomeCardSwapOn')+C.reset:C.yellow+wt('welcomeCardSwapOff')+C.reset);
    console.log(`  ${C.dim}${wt('swapDesc')}${C.reset}`);
    if(await askYesNo(wt('swapEnable'),curSwap)){
      saveAccountSwapEnabled(true);
      ok(wt('swapEnabled'));
    }else{
      saveAccountSwapEnabled(false);
      ok(wt('swapDisabled'));
    }
  }

  // ============== SUMMARY ==============
  hdr(0,wt('stepDone'));
  console.log();
  const faccts=scanAccounts();const facctsReady=faccts.filter(a=>a.token&&a.cookie).length;
  try{pa=require(paFile);}catch{pa=null;}
  const finj=getInjectionPrompt()||process.env.DEEPSEEK_DEFAULT_INJECTION_PROMPT||'';
  const finjOn=process.env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED!=='0'||!!getInjectionPrompt();
  const fswap=getAccountSwapEnabled();

  box(t('summaryTitle'),C.green);
  console.log(`\n  ${C.bold}${wt('welcomeCardAccts')}:${C.reset}`);
  if(faccts.length>0){ok(wt('welcomeCardAcctsFull',{count:faccts.length,ready:facctsReady}));for(let i=0;i<faccts.length;i++){const s=faccts[i].token&&faccts[i].cookie?C.green+'OK'+C.reset:C.red+'MISSING'+C.reset;console.log(`    ${i+1}. ${accountDisplayName(faccts[i],i)} [${s}]`);}}else{err(wt('welcomeCardAcctsNone'));}
  console.log(`\n  ${C.bold}${wt('welcomeCardProxy')}:${C.reset}`);
  (pa&&pa.enabled)?ok(wt('welcomeCardProxyOn',{keys:(pa.apiKeys||[]).length,bearers:(pa.bearerTokens||[]).length})):warn(wt('welcomeCardProxyOff'));
  console.log(`\n  ${C.bold}${wt('welcomeCardInject')}:${C.reset}`);
  finjOn?ok(wt('welcomeCardInjectOn',{chars:finj.length})):warn(wt('welcomeCardInjectOff'));
  console.log(`\n  ${C.bold}${wt('welcomeCardSwap')}:${C.reset}`);
  fswap?ok(wt('welcomeCardSwapOn')):warn(wt('welcomeCardSwapOff'));

  console.log(`\n  ${C.bold}${t('quickStart')}${C.reset}`);
  console.log(`  node server.js`);
  console.log(`  ${C.dim}or double-click startup.bat${C.reset}\n`);
  divider();
  if(await askYesNo(t('startNow'),false)){
    console.log(`\n${C.cyan}${t('starting')}${C.reset}\n`);
    spawnSync('node',['server.js'],{cwd:ROOT,stdio:'inherit',env:{...process.env,NON_INTERACTIVE:'1'}});
  }else{
    console.log(`\n${C.dim}${t('startLater')} node server.js${C.reset}\n`);
  }
}
main().catch(e=>{console.error(`${C.red}Error:${C.reset}`,e.message);process.exit(1);});
