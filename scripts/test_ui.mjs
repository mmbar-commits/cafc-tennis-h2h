import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HTML_PATH = path.join(ROOT, 'index.html');
const OUT_DIR = '/tmp/cafc_ui_shots';
fs.mkdirSync(OUT_DIR, { recursive: true });

const htmlContent = fs.readFileSync(HTML_PATH, 'utf-8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(htmlContent);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const chrome = spawn('chromium', [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=9232',
  '--window-size=1380,1100',
  url
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9232/json');
    const targets = await res.json();
    const page = targets.find(t => t.type === 'page');
    if (page && page.webSocketDebuggerUrl) {
      wsUrl = page.webSocketDebuggerUrl;
      break;
    }
  } catch {}
  await new Promise(r => setTimeout(r, 200));
}
if (!wsUrl) throw new Error('Could not connect to Chromium CDP');

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let msgId = 1;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
  }
});

function cdp(method, params = {}) {
  const id = msgId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evalJs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('Eval error: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function screenshot(filename, fullPage = false) {
  if (fullPage) {
    const metrics = await cdp('Page.getLayoutMetrics');
    const h = Math.min(Math.ceil(metrics.contentSize.height), 2600);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1380, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 150));
  }
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(data, 'base64'));
  if (fullPage) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1380, height: 1100, deviceScaleFactor: 1, mobile: false });
  }
}

await cdp('Runtime.enable');
await cdp('Page.enable');
await new Promise(r => setTimeout(r, 800));

// 1. Accueil + hover tooltip on "Activité de la Ligue Saison par Saison"
await evalJs(`document.querySelectorAll('#home-season-chart .season-col-hit')[7].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))`);
await new Promise(r => setTimeout(r, 220));
const homeCheck = await evalJs(`(() => {
  const cols = document.querySelectorAll('#home-season-chart .season-col-hit');
  const tip = document.getElementById('home-season-tip');
  return {
    activeTab: state.tab,
    colCount: cols.length,
    tipOpacity: getComputedStyle(tip).opacity,
    tipText: tip.textContent.trim(),
    footerHasArchives: document.querySelector('.site-footer').innerText.includes('Source : Archives Mehdi Barouti')
  };
})()`);
console.log('1. HOME & CHART HOVER CHECK:', homeCheck);
if (homeCheck.colCount !== 14 || homeCheck.tipOpacity !== '1' || !homeCheck.tipText.includes('612 matchs')) {
  throw new Error('Home season chart hover tooltip failed: ' + JSON.stringify(homeCheck));
}
await screenshot('01_home_hover.png', true);

// 2. Click player in H2H -> redirects to Profil Joueur; also verify uniqueOpps in H2H Career stats
await evalJs(`(() => {
  const mb = PLAYERS.find(p => p.name === 'Mehdi Barouti');
  const or = PLAYERS.find(p => p.name === 'Omar Rahmouni');
  setPair(mb.id, or.id);
  setStatsMode('career');
})()`);
await new Promise(r => setTimeout(r, 200));
const h2hCheck = await evalJs(`(() => {
  const statsTxt = document.getElementById('stats-panel').innerText;
  const heroTxt = document.getElementById('h2h-hero').innerText;
  return {
    hasAdvDiffInStats: statsTxt.includes('Adversaires différents'),
    hasAdvDiffInHero: heroTxt.includes('adv. diff.'),
    colorA: getComputedStyle(document.querySelector('label[for="input-a"] .picker-label-left')).color,
    colorB: getComputedStyle(document.querySelector('label[for="input-b"] .picker-label-left')).color
  };
})()`);
console.log('2. H2H DIVERSITY & COLORS CHECK:', h2hCheck);
if (!h2hCheck.hasAdvDiffInStats || !h2hCheck.hasAdvDiffInHero) throw new Error('Missing uniqueOpps in H2H');

// Click Mehdi Barouti's name in H2H Hero -> should open Profil Joueur for Mehdi Barouti!
await evalJs(`document.querySelector('#h2h-hero .player-link').click()`);
await new Promise(r => setTimeout(r, 250));
const profCheck = await evalJs(`(() => {
  const h2 = document.querySelector('#profile-root h2')?.textContent.trim();
  const kpis = [...document.querySelectorAll('#profile-root .pkpi-box')].map(b => b.innerText.replace(/\\n+/g, ' | ').trim());
  const oppRows = document.querySelectorAll('#prof-opp-body tbody tr').length;
  const matchRows = document.querySelectorAll('#prof-matches-body .match-row').length;
  const hasDivSvg = !!document.querySelector('#profile-div-chart svg');
  return {
    activeTab: state.tab,
    profileName: h2,
    kpis,
    oppRows,
    matchRows,
    hasDivSvg
  };
})()`);
console.log('3. PROFIL JOUEUR CHECK (from H2H click):', profCheck);
if (profCheck.activeTab !== 'profile' || profCheck.profileName !== 'Mehdi Barouti' || profCheck.oppRows < 50 || profCheck.matchRows !== 120 || !profCheck.hasDivSvg) {
  throw new Error('Profil Joueur check failed: ' + JSON.stringify(profCheck));
}
await screenshot('02_profile_full.png', true);

// Test opponent click inside Profil Joueur -> jumps to that opponent's profile!
await evalJs(`document.querySelector('#prof-opp-body tbody tr:first-child .player-link').click()`);
await new Promise(r => setTimeout(r, 200));
const profJump = await evalJs(`document.querySelector('#profile-root h2')?.textContent.trim()`);
console.log('3b. PROFIL OPPONENT CLICK REDIRECT:', profJump);
if (!profJump || profJump === 'Mehdi Barouti') throw new Error('Opponent click did not switch profile');

// 4. Directory: Adv. diff. column + sort by wins + sort by opps + clicking player name opens Profil Joueur
await evalJs(`switchTab('directory')`);
await new Promise(r => setTimeout(r, 200));
const dirCheck = await evalJs(`(() => {
  const headers = [...document.querySelectorAll('#view-directory .dir-table-scroll thead th')].map(th => th.textContent.trim());
  document.getElementById('dir-sort').value = 'wins';
  renderDirectory();
  const topByWins = [...document.querySelectorAll('#dir-tbody tr')].slice(0, 3).map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
  document.getElementById('dir-sort').value = 'opps';
  renderDirectory();
  const topByOpps = [...document.querySelectorAll('#dir-tbody tr')].slice(0, 3).map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
  return { headers, topByWins, topByOpps };
})()`);
console.log('4. DIRECTORY WINS & OPPS SORT CHECK:', dirCheck);
if (!dirCheck.headers.includes('Adv. diff.')) throw new Error('Missing Adv. diff. column in directory');
await screenshot('03_directory_opps.png', false);

// Click first player name in Directory -> opens Profil Joueur!
await evalJs(`document.querySelector('#dir-tbody tr:first-child .player-link').click()`);
await new Promise(r => setTimeout(r, 200));
const fromDirTab = await evalJs(`({ tab: state.tab, name: document.querySelector('#profile-root h2')?.textContent.trim() })`);
console.log('4b. DIRECTORY NAME CLICK -> PROFILE:', fromDirTab);
if (fromDirTab.tab !== 'profile') throw new Error('Directory name click did not open profile');

// 5. Classement click -> opens Profil Joueur
await evalJs(`switchTab('standings')`);
await new Promise(r => setTimeout(r, 200));
await evalJs(`document.querySelector('#standings-body tbody tr:first-child .player-link').click()`);
await new Promise(r => setTimeout(r, 200));
const fromSt = await evalJs(`({ tab: state.tab, name: document.querySelector('#profile-root h2')?.textContent.trim() })`);
console.log('5. STANDINGS NAME CLICK -> PROFILE:', fromSt);
if (fromSt.tab !== 'profile' || fromSt.name !== 'Zouhair Kazmane') throw new Error('Standings name click failed: ' + JSON.stringify(fromSt));

// 6. Fun Facts check (13 cards including Adversaires Différents & Record de Victoires)
await evalJs(`switchTab('funfacts')`);
await new Promise(r => setTimeout(r, 200));
const ffCheck = await evalJs(`(() => {
  const titles = [...document.querySelectorAll('#funfacts-root .card-title')].map(e => e.textContent.trim());
  return { count: titles.length, hasDiversity: titles.some(t => t.includes('Adversaires Différents')), hasWins: titles.some(t => t.includes('Record de Victoires')) };
})()`);
console.log('6. FUN FACTS CHECK:', ffCheck);
if (!ffCheck.hasDiversity || !ffCheck.hasWins || ffCheck.count !== 13) throw new Error('Fun Facts check failed: ' + JSON.stringify(ffCheck));

console.log('CONSOLE ERRORS:', consoleErrors);
console.log('PAGE ERRORS:', pageErrors);

ws.close();
chrome.kill();
server.close();
if (consoleErrors.length || pageErrors.length) process.exit(1);
