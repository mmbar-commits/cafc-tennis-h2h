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
  '--remote-debugging-port=9231',
  '--window-size=1380,1100',
  url
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9231/json');
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

// 1. Landing tab = Accueil
const homeCheck = await evalJs(`(() => {
  const footerText = document.querySelector('.site-footer').innerText;
  return {
    activeTab: state.tab,
    homeVisible: !document.getElementById('view-home').classList.contains('hidden'),
    kpiCount: document.querySelectorAll('.kpi-card').length,
    hasSeasonSvg: !!document.querySelector('#home-season-chart svg'),
    subtitle: document.getElementById('header-subtitle').textContent,
    footerHasArchives: footerText.includes('Source : Archives Mehdi Barouti'),
    hasTournoiText: document.body.innerText.includes('Tournoi 02.24') || document.body.innerText.includes('Tournoi 02.2024'),
    hasFamilyPhoneText: document.body.innerText.includes('Tél. familial partagé')
  };
})()`);
console.log('1. HOME CHECK:', homeCheck);
if (homeCheck.activeTab !== 'home' || !homeCheck.homeVisible) throw new Error('Default tab should be home');
if (homeCheck.kpiCount !== 6 || !homeCheck.hasSeasonSvg) throw new Error('Home KPIs or chart missing');
if (!homeCheck.footerHasArchives) throw new Error('Footer source mismatch');
if (homeCheck.hasTournoiText) throw new Error('Tournoi text still present');
await screenshot('01_home.png', true);

// 2. H2H tab: swapped colors (Joueur A = green, Joueur B = orange) + Division Actuelle badge + exact STB
await evalJs(`(() => {
  const mb = PLAYERS.find(p => p.name === 'Mehdi Barouti');
  const or = PLAYERS.find(p => p.name === 'Omar Rahmouni');
  setPair(mb.id, or.id);
})()`);
await new Promise(r => setTimeout(r, 250));
const h2hCheck = await evalJs(`(() => {
  const labelA = document.querySelector('label[for="input-a"] .picker-label-left');
  const labelB = document.querySelector('label[for="input-b"] .picker-label-left');
  const curBadges = [...document.querySelectorAll('#h2h-hero .current-div-badge')].map(e => e.textContent.trim());
  const exactTotal = MATCHES.filter(m => m.isStb && m.stb).length;
  const stbTotal = MATCHES.filter(m => m.isStb).length;
  return {
    colorA: getComputedStyle(labelA).color,
    colorB: getComputedStyle(labelB).color,
    curBadges,
    exactTotal,
    stbTotal,
    ddBg: getComputedStyle(document.getElementById('dropdown-a')).backgroundColor
  };
})()`);
console.log('2. H2H CHECK:', h2hCheck);
if (h2hCheck.colorA !== 'rgb(31, 138, 101)') throw new Error('Joueur A should be green (#1f8a65), got ' + h2hCheck.colorA);
if (h2hCheck.colorB !== 'rgb(200, 90, 50)') throw new Error('Joueur B should be orange (#c85a32), got ' + h2hCheck.colorB);
if (h2hCheck.curBadges.length < 1) throw new Error('Missing Division Actuelle badge in H2H hero');
if (h2hCheck.exactTotal < 820) throw new Error('Expected >= 820 exact STBs, got ' + h2hCheck.exactTotal);
await screenshot('02_h2h.png', true);

// 3. Classement tab: live Automne 2026 general + by-division + historical Hiver 2023
await evalJs(`switchTab('standings')`);
await new Promise(r => setTimeout(r, 250));
const stGeneral = await evalJs(`(() => ({
  seasonVal: document.getElementById('st-season').value,
  banner: document.getElementById('standings-banner').innerText.replace(/\\s+/g, ' ').trim(),
  rows: document.querySelectorAll('#standings-body tbody tr').length,
  firstRow: document.querySelector('#standings-body tbody tr')?.innerText.replace(/\\s+/g, ' ').trim()
}))()`);
console.log('3a. STANDINGS GENERAL (s14):', stGeneral);
if (stGeneral.seasonVal !== 's14' || stGeneral.rows !== 130) throw new Error('Unexpected s14 standings rows: ' + stGeneral.rows);
await screenshot('03_standings_general.png', false);

await evalJs(`setStandingsMode('division')`);
await new Promise(r => setTimeout(r, 200));
const stDiv = await evalJs(`document.querySelectorAll('#standings-body .div-block').length`);
console.log('3b. STANDINGS BY DIVISION BLOCKS:', stDiv);
if (stDiv !== 13) throw new Error('Expected 13 divisions in s14, got ' + stDiv);
await screenshot('03b_standings_divisions.png', false);

await evalJs(`(() => {
  const sel = document.getElementById('st-season');
  sel.value = 's01';
  onStandingsSeasonChange();
  setStandingsMode('general');
})()`);
await new Promise(r => setTimeout(r, 200));
const stS01 = await evalJs(`({
  banner: document.getElementById('standings-banner').innerText.replace(/\\s+/g, ' ').trim(),
  rows: document.querySelectorAll('#standings-body tbody tr').length
})`);
console.log('3c. STANDINGS HISTORICAL (s01):', stS01);
if (stS01.rows < 60) throw new Error('Expected >= 60 players in s01, got ' + stS01.rows);

// 4. Grandes Rivalités: searched player ALWAYS on the left!
await evalJs(`(() => {
  switchTab('rivalries');
  const inp = document.getElementById('riv-search');
  inp.value = 'Rahmouni';
  document.getElementById('riv-min').value = '3';
  renderRivalries();
})()`);
await new Promise(r => setTimeout(r, 200));
const rivCheck = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#rivalries-grid .rivalry-card')];
  const pairs = cards.map(c => {
    const spans = c.querySelectorAll('.rivalry-top > span');
    return { left: spans[0].textContent.trim(), score: spans[1].textContent.trim(), right: spans[2].textContent.trim() };
  });
  const allLeft = pairs.length > 0 && pairs.every(p => p.left.toLowerCase().includes('rahmouni'));
  return { count: pairs.length, allLeft, sample: pairs.slice(0, 4) };
})()`);
console.log('4. RIVALRIES LEFT-SEARCH CHECK:', rivCheck);
if (!rivCheck.allLeft) throw new Error('Searched player is NOT always on the left in Grandes Rivalités!');
await screenshot('04_rivalries_search.png', false);

// 5. Fun Facts tab
await evalJs(`switchTab('funfacts')`);
await new Promise(r => setTimeout(r, 250));
const ffCheck = await evalJs(`(() => {
  const titles = [...document.querySelectorAll('#funfacts-root .card-title')].map(e => e.textContent.trim());
  const fideles = document.querySelectorAll('#funfacts-root .fidele-chip').length;
  return { cardCount: titles.length, titles, fideles };
})()`);
console.log('5. FUN FACTS CHECK:', ffCheck);
if (ffCheck.cardCount < 10 || ffCheck.fideles < 20) throw new Error('Fun facts missing cards or fideles');
await screenshot('05_funfacts.png', true);

// 6. Directory tab: Div. Actuelle + Première saison + Top / Intermédiaires / Progression filters + scrollability
await evalJs(`switchTab('directory')`);
await new Promise(r => setTimeout(r, 250));
const dirCheck = await evalJs(`(() => {
  const scroller = document.querySelector('#view-directory .dir-table-scroll');
  const headers = [...document.querySelectorAll('#view-directory .dir-table-scroll thead th')].map(th => th.textContent.trim());
  const counts = {};
  for (const val of ['all', 'current', 'top', 'mid', 'prog', 'homonym', 'active50']) {
    document.getElementById('dir-filter').value = val;
    renderDirectory();
    counts[val] = document.querySelectorAll('#dir-tbody > tr').length;
  }
  document.getElementById('dir-filter').value = 'all';
  renderDirectory();
  return {
    headers,
    counts,
    isScrollable: scroller.scrollHeight > scroller.clientHeight
  };
})()`);
console.log('6. DIRECTORY CHECK:', dirCheck);
if (!dirCheck.headers.includes('Première saison') || !dirCheck.headers.includes('Div. Actuelle')) {
  throw new Error('Missing expected columns in directory');
}
if (!dirCheck.isScrollable) throw new Error('Directory table is not scrollable');
if (dirCheck.counts.top === 0 || dirCheck.counts.mid === 0 || dirCheck.counts.prog === 0 || dirCheck.counts.current !== 130) {
  throw new Error('Unexpected directory filter counts: ' + JSON.stringify(dirCheck.counts));
}
await screenshot('06_directory.png', false);

console.log('CONSOLE ERRORS:', consoleErrors);
console.log('PAGE ERRORS:', pageErrors);

ws.close();
chrome.kill();
server.close();
if (consoleErrors.length || pageErrors.length) process.exit(1);
