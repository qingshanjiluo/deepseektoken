#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };

function rl() { return readline.createInterface({ input: process.stdin, output: process.stdout }); }
function ask(msg, def) {
  return new Promise(resolve => {
    const r = rl();
    r.question(`\n  ${msg}${def ? ` (${def})` : ''}: `, ans => { r.close(); resolve(ans.trim() || def); });
  });
}

function run(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'pipe', shell: true, env: { ...process.env, GIT_SSL_NO_VERIFY: '1' } });
    return { ok: r.status === 0, out: (r.stdout || '').toString().trim(), err: (r.stderr || '').toString().trim(), status: r.status };
  } catch (e) { return { ok: false, out: '', err: e.message, status: -1 }; }
}

function divider(ch, n) { console.log(C.dim + (ch || '\u2500').repeat(n || 56) + C.reset); }

async function main() {
  console.clear();
  console.log(C.cyan + '\u250c' + '\u2500'.repeat(54) + '\u2510' + C.reset);
  console.log(C.cyan + '\u2502' + ' '.repeat(11) + C.bold + 'Git Push \u2502 One-Click Upload' + C.reset + C.cyan + ' '.repeat(12) + '\u2502' + C.reset);
  console.log(C.cyan + '\u2514' + '\u2500'.repeat(54) + '\u2518' + C.reset);
  console.log();

  // ---- git status ----
  const stat = run('git', ['status', '--short']);
  if (!stat.ok) {
    console.log(`  ${C.red}\u2716${C.reset} git status failed: ${stat.err}`);
    process.exit(1);
  }
  if (!stat.out) {
    console.log(`  ${C.green}\u2714${C.reset} Working tree clean. Nothing to commit.`);
    process.exit(0);
  }

  const lines = stat.out.split('\n').filter(Boolean);
  console.log(`  ${C.yellow}${lines.length}${C.reset} file(s) changed:`);
  for (const line of lines.slice(0, 30)) {
    const status = line.substring(0, 2).trim();
    const file = line.substring(2).trim();
    const color = status.startsWith('M') ? C.yellow : status.startsWith('A') || status === '??' ? C.green : status.startsWith('D') ? C.red : C.dim;
    console.log(`    ${color}${status}${C.reset} ${file}`);
  }
  if (lines.length > 30) console.log(`    ${C.dim}... and ${lines.length - 30} more${C.reset}`);

  // ---- branch ----
  const branchR = run('git', ['branch', '--show-current']);
  const branch = branchR.ok ? branchR.out.split('\n')[0] : 'main';
  console.log(`\n  ${C.dim}Branch: ${branch}${C.reset}`);

  // ---- version ----
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const currentVer = pkg.version || '0.0.0';
  const autoVer = currentVer.replace(/^(\d+\.\d+\.)(\d+)$/, (_, prefix, patch) => prefix + (parseInt(patch, 10) + 1));

  console.log(`\n  ${C.bold}Version:${C.reset}`);
  console.log(`    Current  : ${currentVer}`);
  console.log(`    Suggested: ${autoVer}`);
  let ver = await ask('Enter version (leave empty to keep)', currentVer);
  if (!ver) ver = currentVer;

  // Update package.json version
  if (ver !== currentVer) {
    pkg.version = ver;
    fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ${C.green}\u2714${C.reset} package.json version updated to ${ver}`);
    run('git', ['add', 'package.json']);
  }

  // ---- commit message ----
  console.log(`\n  ${C.bold}Commit message:${C.reset}`);
  const commitType = await chooseCommitType();
  console.log(`    Type: ${commitType}`);
  const scope = await ask('Scope (optional, e.g. auth, server, wizard)');
  const summary = await ask('Summary (required)');
  if (!summary) { console.log(`  ${C.red}\u2716${C.reset} Summary is required.`); process.exit(1); }
  const detail = await ask('Detail (optional, multi-line OK)');

  let msg = `${commitType}`;
  if (scope) msg += `(${scope})`;
  msg += `: ${summary}`;
  if (detail) msg += `\n\n${detail}`;

  console.log(`\n  ${C.dim}Preview:${C.reset}`);
  console.log(`  ${C.yellow}${msg.replace(/\n/g, '\n  ')}${C.reset}\n`);

  const confirm = (await ask('Proceed? (y/n)', 'y')).toLowerCase();
  if (confirm !== 'y' && confirm !== 'yes') {
    console.log(`  ${C.yellow}Aborted.${C.reset}`);
    process.exit(0);
  }

  // ---- add all ----
  console.log(`\n  ${C.cyan}git add -A${C.reset}`);
  const addR = run('git', ['add', '-A']);
  if (!addR.ok) { console.log(`  ${C.red}\u2716${C.reset} git add failed`); process.exit(1); }

  // ---- commit ----
  console.log(`  ${C.cyan}git commit${C.reset}`);
  const tmpFile = path.join(ROOT, '.git-commit-msg.tmp');
  fs.writeFileSync(tmpFile, msg, 'utf8');
  const commitR = run('git', ['commit', '-F', tmpFile]);
  fs.unlinkSync(tmpFile);
  if (!commitR.ok) {
    console.log(`  ${C.red}\u2716${C.reset} git commit failed:\n  ${commitR.err}`);
    process.exit(1);
  }
  const commitHash = (commitR.out.match(/\[[^\]]+\s+([a-f0-9]+)\]/) || [])[1] || '';
  console.log(`  ${C.green}\u2714${C.reset} Committed ${commitHash ? commitHash.substring(0, 7) : 'OK'}`);

  // ---- push ----
  console.log(`  ${C.cyan}git push${C.reset}`);
  const pushR = run('git', ['-c', 'http.sslVerify=false', 'push', 'origin', branch]);
  if (!pushR.ok) {
    // Try force-with-lease
    console.log(`  ${C.yellow}Normal push rejected, trying fetch + force-with-lease...${C.reset}`);
    const fetchR = run('git', ['-c', 'http.sslVerify=false', 'fetch', 'origin', branch]);
    const pushR2 = run('git', ['-c', 'http.sslVerify=false', 'push', '--force-with-lease', 'origin', branch]);
    if (!pushR2.ok) {
      console.log(`  ${C.red}\u2716${C.reset} Push failed:\n  ${pushR2.err}`);
      process.exit(1);
    }
    console.log(`  ${C.green}\u2714${C.reset} Force-pushed (with lease)`);
  } else {
    console.log(`  ${C.green}\u2714${C.reset} Pushed to ${branch}`);
  }

  divider();
  console.log(`\n  ${C.green + C.bold}\u2714 Done!${C.reset}  ${C.dim}${ver} \u2192 origin/${branch}${C.reset}`);
  if (ver !== currentVer) console.log(`  ${C.dim}Version bumped: ${currentVer} -> ${ver}${C.reset}`);
  console.log();
}

async function chooseCommitType() {
  const types = [
    { key: 'feat', desc: 'New feature' },
    { key: 'fix', desc: 'Bug fix' },
    { key: 'perf', desc: 'Performance improvement' },
    { key: 'refactor', desc: 'Code refactoring' },
    { key: 'style', desc: 'Code style / formatting' },
    { key: 'docs', desc: 'Documentation' },
    { key: 'test', desc: 'Tests' },
    { key: 'chore', desc: 'Build / deps / maintenance' },
    { key: 'ci', desc: 'CI / pipeline' },
  ];
  for (let i = 0; i < types.length; i++) {
    console.log(`    ${C.green}${i + 1}${C.reset}  ${C.bold}${types[i].key}${C.reset}  ${C.dim}- ${types[i].desc}${C.reset}`);
  }
  while (true) {
    const ans = await ask('Choose type', '1');
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= types.length) return types[num - 1].key;
  }
}

main().catch(e => { console.error(`${C.red}Error:${C.reset}`, e.message); process.exit(1); });
