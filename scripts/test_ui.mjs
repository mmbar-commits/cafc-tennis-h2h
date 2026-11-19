import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HTML_PATH = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'screenshots');
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
  '--remote-debugging-port=9230',
  '--window-size=1380,1100',
  url
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9230/json');
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

// 1. Initial render (standalone — NO artificial CSS token injection!)
const initCheck = await evalJs(`(() => {
  const ddStyle = getComputedStyle(document.getElementById('dropdown-a'));
  const cardStyle = getComputedStyle(document.querySelector('.card'));
  const footerText = document.querySelector('.site-footer').innerText;
  return {
    title: document.title,
    h1: document.querySelector('.brand-title').textContent,
    subtitle: document.getElementById('header-subtitle').textContent,
    matchesCount: document.getElementById('matches-count-pill').textContent,
    commonCount: document.getElementById('common-count-pill').textContent,
    inputA: document.getElementById('input-a').value,
    inputB: document.getElementById('input-b').value,
    dropdownBg: ddStyle.backgroundColor,
    cardBg: cardStyle.backgroundColor,
    hasCopyWaBtn: !!document.getElementById('copy-wa-btn'),
    hasCompFilter: document.querySelectorAll('[data-comp]').length,
    footerHasArchives: footerText.includes('Source : Archives Mehdi Barouti'),
    hasTournoiText: document.body.innerText.includes('Tournoi 02.24') || document.body.innerText.includes('Tournoi 02.2024'),
    hasFamilyPhoneText: document.body.innerText.includes('Tél. familial partagé')
  };
})()`);
console.log('1. INIT CHECK:', initCheck);
if (initCheck.dropdownBg === 'rgba(0, 0, 0, 0)' || initCheck.dropdownBg === 'transparent') {
  throw new Error('Dropdown background is transparent: ' + initCheck.dropdownBg);
}
if (initCheck.hasCopyWaBtn) throw new Error('copy-wa-btn should be removed');
if (initCheck.hasCompFilter !== 0) throw new Error('compFilter should be removed');
if (!initCheck.footerHasArchives) throw new Error('Footer source text mismatch');
if (initCheck.hasTournoiText) throw new Error('Tournoi text still present');
await screenshot('01_h2h_standalone_full.png', true);

// 2. Autocomplete dropdown on Joueur B (reproducing user screenshot scenario!)
await evalJs(`(() => {
  const mb = PLAYERS.find(p => p.name === 'Mehdi Barouti');
  const ms = PLAYERS.find(p => p.name === 'Majid Slimani');
  setPair(mb.id, ms.id);
  const inp = document.getElementById('input-b');
  inp.focus();
  inp.dispatchEvent(new Event('focus'));
})()`);
await new Promise(r => setTimeout(r, 200));
const ddCheck = await evalJs(`(() => {
  const dd = document.getElementById('dropdown-b');
  return {
    visible: !dd.classList.contains('hidden'),
    bg: getComputedStyle(dd).backgroundColor,
    zIndex: getComputedStyle(dd).zIndex,
    rows: document.querySelectorAll('.combo-row-b').length
  };
})()`);
console.log('2. DROPDOWN B CHECK:', ddCheck);
await screenshot('02_dropdown_opaque.png', false);

// 3. Exact Super Tie-Break score check (Mehdi Barouti vs Omar Rahmouni + Anas Kabbaj vs Catherine Yans 22-20)
await evalJs(`(() => {
  closeDropdown('b');
  const mb = PLAYERS.find(p => p.name === 'Mehdi Barouti');
  const or = PLAYERS.find(p => p.name === 'Omar Rahmouni');
  setPair(mb.id, or.id);
})()`);
await new Promise(r => setTimeout(r, 200));
const stbCheck = await evalJs(`(() => {
  const pills = [...document.querySelectorAll('.set-pill.homonym-badge')].map(el => el.textContent.trim());
  const exactTotal = MATCHES.filter(m => m.isStb && m.stb).length;
  const stbTotal = MATCHES.filter(m => m.isStb).length;
  return { baroutiRahmouniStbs: pills, exactTotal, stbTotal };
})()`);
console.log('3. EXACT STB CHECK:', stbCheck);
if (stbCheck.exactTotal < 750) throw new Error('Expected >=750 exact STBs, got ' + stbCheck.exactTotal);
await screenshot('03_h2h_exact_stb.png', true);

// 4. Family phone check (Zouhair Kazmane vs Amine Sebti — verify no "Tél. familial partagé" & no "Ancien n° fusionné")
await evalJs(`(() => {
  const a = PLAYERS.find(p => p.name === 'Amine Sebti');
  const b = PLAYERS.find(p => p.name === 'Zouhair Kazmane');
  setPair(a.id, b.id);
})()`);
await new Promise(r => setTimeout(r, 200));
const phoneCheck = await evalJs(`(() => {
  const heroTxt = document.getElementById('h2h-hero').innerText;
  return {
    hasFamilyText: heroTxt.includes('Tél. familial'),
    hasOldPhoneText: heroTxt.includes('Ancien n°'),
    aminePhone: PLAYERS.find(p => p.name === 'Amine Sebti').phone,
    kazmanePhone: PLAYERS.find(p => p.name === 'Zouhair Kazmane').phone
  };
})()`);
console.log('4. PHONE & FAMILY CHECK:', phoneCheck);
if (phoneCheck.hasFamilyText || phoneCheck.hasOldPhoneText) {
  throw new Error('Family/old phone text still present in hero');
}

// 5. Directory & Homonyms tab: scrollable table + Première saison column
await evalJs(`switchTab('directory')`);
await new Promise(r => setTimeout(r, 250));
const dirCheck = await evalJs(`(() => {
  const scroller = document.querySelector('.dir-table-scroll');
  const headers = [...document.querySelectorAll('.dir-table-scroll thead th')].map(th => th.textContent.trim());
  const firstRow = [...document.querySelectorAll('#dir-tbody tr:first-child td')].map(td => td.innerText.replace(/\\n+/g, ' | ').trim());
  return {
    homCards: document.querySelectorAll('#homonym-cards > div').length,
    dirRows: document.querySelectorAll('#dir-tbody > tr').length,
    headers,
    firstRow,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    isScrollable: scroller.scrollHeight > scroller.clientHeight
  };
})()`);
console.log('5. DIRECTORY CHECK:', dirCheck);
if (!dirCheck.headers.includes('Première saison')) throw new Error('Missing Première saison column');
if (!dirCheck.isScrollable) throw new Error('Directory table is not independently scrollable');
await screenshot('04_directory_scrollable.png', false);

// 6. Grandes Rivalités tab
await evalJs(`switchTab('rivalries')`);
await new Promise(r => setTimeout(r, 200));
const rivCheck = await evalJs(`document.querySelectorAll('#rivalries-grid > button').length`);
console.log('6. RIVALRIES COUNT (4+ matches):', rivCheck);

console.log('CONSOLE ERRORS:', consoleErrors);
console.log('PAGE ERRORS:', pageErrors);

ws.close();
chrome.kill();
server.close();
if (consoleErrors.length || pageErrors.length) process.exit(1);
