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
await new Promise(r => setTimeout(r, 1500));

// Inject realistic Light theme tokens
await evalJs(`(() => {
  document.documentElement.style.setProperty('--background', '#f6f5f2');
  document.documentElement.style.setProperty('--card', '#ffffff');
  document.documentElement.style.setProperty('--border', '#e4e2dc');
  document.documentElement.style.setProperty('--foreground', '#18181b');
  document.documentElement.style.setProperty('--muted-foreground', '#6b6860');
  document.documentElement.style.setProperty('--primary', '#c85a32');
})()`);
await new Promise(r => setTimeout(r, 250));

// 1. Initial render
const initCheck = await evalJs(`({
  subtitle: document.getElementById('header-subtitle').textContent,
  matchesCount: document.getElementById('matches-count-pill').textContent,
  commonCount: document.getElementById('common-count-pill').textContent,
  inputA: document.getElementById('input-a').value,
  inputB: document.getElementById('input-b').value
})`);
console.log('1. INIT CHECK:', initCheck);
await screenshot('01_h2h_light_full.png', true);

// 2. Homonym search ("Saad Bennani")
await evalJs(`(() => {
  focusPicker('a');
  const inp = document.getElementById('input-a');
  inp.value = 'Saad Bennani';
  inp.dispatchEvent(new Event('input'));
})()`);
await new Promise(r => setTimeout(r, 200));
const homCheck = await evalJs(`[...document.querySelectorAll('.combo-row-a')].map(el => el.innerText.replace(/\\n+/g, ' | '))`);
console.log('2. SAAD BENNANI DROPDOWN:', homCheck);
await screenshot('02_homonym_dropdown.png', false);

// 3. Simo Zizi search
await evalJs(`(() => {
  const inp = document.getElementById('input-a');
  inp.value = 'Simo Zizi';
  inp.dispatchEvent(new Event('input'));
})()`);
const simoCheck = await evalJs(`[...document.querySelectorAll('.combo-row-a')].map(el => el.innerText.replace(/\\n+/g, ' | '))`);
console.log('3. SIMO ZIZI DROPDOWN:', simoCheck);

// 4. Select Saad Bennani (Étoile) vs Taoufik Darraz in Dark Mode
await evalJs(`(() => {
  closeDropdown('a');
  const sb = PLAYERS.find(p => p.name === 'Saad Bennani' && p.phoneDigits.includes('4647'));
  const td = PLAYERS.find(p => p.name === 'Taoufik Darraz');
  setPair(sb.id, td.id);
  document.documentElement.style.setProperty('--background', '#121316');
  document.documentElement.style.setProperty('--card', '#1a1c21');
  document.documentElement.style.setProperty('--border', '#2c2f38');
  document.documentElement.style.setProperty('--foreground', '#f1f2f4');
  document.documentElement.style.setProperty('--muted-foreground', '#9ca3af');
})()`);
await new Promise(r => setTimeout(r, 250));
const sbCheck = await evalJs(`({
  inputA: document.getElementById('input-a').value,
  matches: document.getElementById('matches-count-pill').textContent,
  common: document.getElementById('common-count-pill').textContent
})`);
console.log('4. SAAD BENNANI (ETOILE) vs TAOUFIK DARRAZ:', sbCheck);
await screenshot('03_h2h_dark_homonym.png', true);

// 5. Zero direct matches test (Saad Bennani Div 6 vs Zouhair Kazmane)
await evalJs(`(() => {
  const sb2 = PLAYERS.find(p => p.name === 'Saad Bennani' && p.phoneDigits.includes('0724'));
  const zk = PLAYERS.find(p => p.name === 'Zouhair Kazmane');
  setPair(sb2.id, zk.id);
})()`);
await new Promise(r => setTimeout(r, 200));
const zeroCheck = await evalJs(`({
  matches: document.getElementById('matches-count-pill').textContent,
  statsMode: state.statsMode,
  common: document.getElementById('common-count-pill').textContent
})`);
console.log('5. ZERO DIRECT MATCHES CHECK:', zeroCheck);

// 6. Test Competition Filter (Tournoi 02.2024: Amine Sebti vs Salim Chaoui)
await evalJs(`(() => {
  const a = PLAYERS.find(p => p.name === 'Amine Sebti');
  const b = PLAYERS.find(p => p.name === 'Salim Chaoui');
  setPair(a.id, b.id);
  setCompFilter('tournoi');
})()`);
const tournoiCheck = await evalJs(`({
  tournoiMatches: document.getElementById('matches-count-pill').textContent
})`);
await evalJs(`setCompFilter('all')`);
const allCheck = await evalJs(`({
  allMatches: document.getElementById('matches-count-pill').textContent
})`);
console.log('6. COMP FILTER CHECK (Amine Sebti vs Salim Chaoui):', { ...tournoiCheck, ...allCheck });

// 7. Directory & Homonyms tab (Light Mode)
await evalJs(`(() => {
  document.documentElement.style.setProperty('--background', '#f6f5f2');
  document.documentElement.style.setProperty('--card', '#ffffff');
  document.documentElement.style.setProperty('--border', '#e4e2dc');
  document.documentElement.style.setProperty('--foreground', '#18181b');
  document.documentElement.style.setProperty('--muted-foreground', '#6b6860');
  switchTab('directory');
})()`);
await new Promise(r => setTimeout(r, 250));
const dirCheck = await evalJs(`({
  homCards: document.querySelectorAll('#homonym-cards > div').length,
  dirRows: document.querySelectorAll('#dir-tbody > tr').length
})`);
console.log('7. DIRECTORY CHECK:', dirCheck);
await screenshot('04_directory_homonyms.png', false);

// 8. Grandes Rivalités tab
await evalJs(`switchTab('rivalries')`);
await new Promise(r => setTimeout(r, 200));
const rivCheck = await evalJs(`document.querySelectorAll('#rivalries-grid > button').length`);
console.log('8. RIVALRIES COUNT (4+ matches):', rivCheck);
await screenshot('05_rivalries.png', false);

console.log('CONSOLE ERRORS:', consoleErrors);
console.log('PAGE ERRORS:', pageErrors);

ws.close();
chrome.kill();
server.close();
if (consoleErrors.length || pageErrors.length) process.exit(1);
