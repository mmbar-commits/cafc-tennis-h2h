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
  '--remote-debugging-port=9233',
  '--window-size=1380,1100',
  url
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9233/json');
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

// 1. Accueil: no badge "2" on Annuaire + pro-rata 4-month chart hover tooltip
await evalJs(`document.querySelectorAll('#home-season-chart .season-col-hit')[7].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))`);
await new Promise(r => setTimeout(r, 220));
const homeCheck = await evalJs(`(() => {
  const tip = document.getElementById('home-season-tip');
  const note = document.querySelector('#home-season-chart .chart-footnote')?.textContent.trim();
  const dirBtnText = document.getElementById('tab-directory').textContent.trim();
  return {
    activeTab: state.tab,
    dirBtnText,
    tipOpacity: getComputedStyle(tip).opacity,
    tipText: tip.textContent.trim(),
    note
  };
})()`);
console.log('1. HOME & PRO-RATA CHART CHECK:', homeCheck);
if (homeCheck.dirBtnText !== 'Annuaire') throw new Error('Annuaire button should not have a badge: ' + homeCheck.dirBtnText);
if (homeCheck.tipOpacity !== '1' || !homeCheck.tipText.includes('459 matchs/3m (612 réels)')) {
  throw new Error('Pro-rata 4-month tooltip failed: ' + JSON.stringify(homeCheck));
}
await screenshot('01_home_prorata.png', true);

// 2. Classement: default mode = Par division + green top-3 & red bottom-3 (slots 8-10) + Place Vacante
await evalJs(`switchTab('standings')`);
await new Promise(r => setTimeout(r, 200));
const stCur = await evalJs(`(() => {
  const etoileRows = [...document.querySelectorAll('#standings-body .div-block:first-child tbody tr')];
  const vacantRows = [...document.querySelectorAll('#standings-body tr.row-vacant')];
  const vacantClickable = vacantRows.some(tr => tr.querySelector('button, a'));
  return {
    mode: state.standingsMode,
    season: state.standingsSeason,
    divBlocks: document.querySelectorAll('#standings-body .div-block').length,
    etoileRowCount: etoileRows.length,
    etoilePos7Class: etoileRows[6]?.className || '',
    etoilePos8Class: etoileRows[7]?.className || '',
    etoilePos10Text: etoileRows[9]?.innerText.replace(/\\s+/g, ' ').trim(),
    vacantCount: vacantRows.length,
    vacantClickable,
    promoRows: document.querySelectorAll('#standings-body tr.row-promo').length,
    relegRows: document.querySelectorAll('#standings-body tr.row-releg').length
  };
})()`);
console.log('2a. STANDINGS DEFAULT (s14 Par division + promo/releg + Place Vacante):', stCur);
if (stCur.mode !== 'division' || stCur.divBlocks !== 13 || stCur.etoileRowCount !== 10 || stCur.etoilePos7Class.includes('row-releg') || !stCur.etoilePos8Class.includes('row-releg') || stCur.vacantCount !== 3 || stCur.vacantClickable || stCur.promoRows !== 39 || stCur.relegRows !== 39) {
  throw new Error('Standings current season check failed: ' + JSON.stringify(stCur));
}
await screenshot('02_standings_promo_releg.png', false);

// Switch to historical season s01 -> NO promo/releg highlights!
await evalJs(`(() => {
  const sel = document.getElementById('st-season');
  sel.value = 's01';
  onStandingsSeasonChange();
})()`);
await new Promise(r => setTimeout(r, 200));
const stHist = await evalJs(`({
  season: state.standingsSeason,
  promoRows: document.querySelectorAll('#standings-body tr.row-promo').length,
  relegRows: document.querySelectorAll('#standings-body tr.row-releg').length
})`);
console.log('2b. STANDINGS HISTORICAL (s01 no highlights):', stHist);
if (stHist.season !== 's01' || stHist.promoRows !== 0 || stHist.relegRows !== 0) {
  throw new Error('Historical season should have 0 promo/releg highlights: ' + JSON.stringify(stHist));
}

// Return to Accueil and click "Classement en cours" -> MUST reset season to s14!
await evalJs(`switchTab('home')`);
await new Promise(r => setTimeout(r, 150));
await evalJs(`(() => {
  const btn = [...document.querySelectorAll('#view-home button')].find(b => b.textContent.trim() === 'Classement en cours');
  btn.click();
})()`);
await new Promise(r => setTimeout(r, 200));
const stReset = await evalJs(`({
  tab: state.tab,
  season: state.standingsSeason,
  selectVal: document.getElementById('st-season').value,
  promoRows: document.querySelectorAll('#standings-body tr.row-promo').length
})`);
console.log('2c. RETURN VIA "CLASSEMENT EN COURS" RESET CHECK:', stReset);
if (stReset.tab !== 'standings' || stReset.season !== 's14' || stReset.selectVal !== 's14' || stReset.promoRows !== 39) {
  throw new Error('Classement en cours button did not reset to s14: ' + JSON.stringify(stReset));
}

// 3. Annuaire: Annuaire Complet FIRST, Gestion des Homonymes SECOND (below)
await evalJs(`switchTab('directory')`);
await new Promise(r => setTimeout(r, 200));
const dirOrder = await evalJs(`[...document.querySelectorAll('#view-directory > .card h2.card-title')].map(h => h.textContent.replace(/\\s+/g, ' ').trim())`);
console.log('3. DIRECTORY CARD ORDER:', dirOrder);
if (!dirOrder[0].startsWith('Annuaire Complet') || !dirOrder[1].startsWith('Gestion des Homonymes')) {
  throw new Error('Directory card order wrong: ' + JSON.stringify(dirOrder));
}
await screenshot('03_directory_order.png', true);

// 4. Match dates + 3e set complet vs Super Tie-Break checks across H2H, Profil Joueur, Fun Facts
const datesCheck = await evalJs(`(() => {
  const dated = MATCHES.filter(m => !!m.dtFmt).length;
  const full3 = MATCHES.filter(m => m.sets.length === 3 && !m.isStb).length;
  const stbs = MATCHES.filter(m => m.isStb).length;
  return { total: MATCHES.length, dated, full3, stbs };
})()`);
console.log('4a. DATES & DECIDERS DATASET CHECK:', datesCheck);
if (datesCheck.dated < 4500 || datesCheck.full3 < 500 || datesCheck.stbs < 800) {
  throw new Error('Dates or decider counts unexpectedly low: ' + JSON.stringify(datesCheck));
}

// H2H check: dates visible + 3e set complet vs STB in H2H & Career modes
await evalJs(`switchTab('h2h', { track: false })`);
await new Promise(r => setTimeout(r, 200));
const h2hCheck = await evalJs(`(() => {
  const datePills = document.querySelectorAll('#matches-list .date-pill').length;
  const directText = document.getElementById('stats-panel').textContent;
  setStatsMode('career');
  const careerText = document.getElementById('stats-panel').textContent;
  setStatsMode('h2h');
  return {
    datePills,
    hasDirectFull3: directText.includes('3e set complet (hors STB)'),
    hasDirectStb: directText.includes('Super Tie-Breaks'),
    hasCareerFull3: careerText.includes('3e set complet (hors STB)'),
    hasCareerShare: careerText.includes('Part 3e set / décisifs')
  };
})()`);
console.log('4b. H2H DATES & 3RD SET VS STB CHECK:', h2hCheck);
if (h2hCheck.datePills < 1 || !h2hCheck.hasDirectFull3 || !h2hCheck.hasDirectStb || !h2hCheck.hasCareerFull3 || !h2hCheck.hasCareerShare) {
  throw new Error('H2H dates/decider check failed: ' + JSON.stringify(h2hCheck));
}
await screenshot('04_h2h_dates_deciders.png', true);

// Profil Joueur check: test on Mehdi Barouti (who has both full 3rd sets and STBs)
await evalJs(`(() => {
  const mb = PLAYERS.find(p => p.name.includes('Mehdi Barouti'));
  openProfile(mb.id);
})()`);
await new Promise(r => setTimeout(r, 200));
const profCheck = await evalJs(`(() => {
  const panel = document.querySelector('#profile-root .decider-panel');
  const panelText = panel ? panel.textContent.replace(/\\s+/g, ' ').trim() : '';
  const hasSplitBar = !!document.querySelector('#profile-root .decider-split-bar');
  const hasPerfGrid = document.querySelectorAll('#profile-root .decider-mini').length === 2;
  const datePills = document.querySelectorAll('#prof-matches-body .date-pill').length;
  const sel = document.getElementById('prof-m-res');
  sel.value = 'full3';
  renderProfileMatches();
  const full3CountText = document.getElementById('prof-matches-count-pill')?.textContent.trim();
  const full3Shown = parseInt((full3CountText || '0').split('/')[0].trim(), 10);
  const full3HasStbBadge = document.getElementById('prof-matches-body').textContent.includes('Super TB');
  sel.value = 'all';
  renderProfileMatches();
  return {
    hasPanel: !!panel,
    hasSplitBar,
    hasPerfGrid,
    panelText: panelText.slice(0, 180),
    datePills,
    full3CountText,
    full3Shown,
    full3HasStbBadge
  };
})()`);
console.log('4c. PROFIL JOUEUR DECIDER PANEL & DATES CHECK (Mehdi Barouti):', profCheck);
if (!profCheck.hasPanel || !profCheck.hasSplitBar || !profCheck.hasPerfGrid || profCheck.datePills < 10 || profCheck.full3Shown < 1 || profCheck.full3HasStbBadge) {
  throw new Error('Profil Joueur decider/date check failed: ' + JSON.stringify(profCheck));
}
await screenshot('05_profile_deciders_dates.png', true);

// Fun Facts check: Rois du 3e Set Complet card present + dates in Craziest STBs
await evalJs(`switchTab('funfacts', { track: false })`);
await new Promise(r => setTimeout(r, 200));
const ffCheck = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('#funfacts-root > .card')];
  const titles = cards.map(c => c.querySelector('h3.card-title')?.textContent.trim());
  const full3Card = cards.find(c => c.querySelector('h3.card-title')?.textContent.trim() === 'Rois du 3e Set Complet');
  const full3Rows = full3Card ? full3Card.querySelectorAll('.ff-row').length : 0;
  const text = document.getElementById('funfacts-root').textContent;
  return {
    cardCount: titles.length,
    hasFull3Kings: titles.includes('Rois du 3e Set Complet'),
    full3Rows,
    hasStbKings: titles.includes('Rois du Super Tie-Break'),
    hasDatePattern: /\\(\\d{2}\\/\\d{2}\\/202\\d\\)/.test(text)
  };
})()`);
console.log('4d. FUN FACTS FULL3 KINGS & DATES CHECK:', ffCheck);
if (!ffCheck.hasFull3Kings || ffCheck.full3Rows < 5 || !ffCheck.hasStbKings || !ffCheck.hasDatePattern) {
  throw new Error('Fun Facts check failed: ' + JSON.stringify(ffCheck));
}
await screenshot('06_funfacts_full3.png', true);

// 5. Mobile 390px viewport check across ALL 7 tabs -> zero horizontal page overflow!
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await new Promise(r => setTimeout(r, 150));
const mobileOverflows = {};
for (const t of ['home', 'h2h', 'profile', 'standings', 'rivalries', 'funfacts', 'directory']) {
  await evalJs(`switchTab('${t}', { track: false })`);
  await new Promise(r => setTimeout(r, 150));
  const m = await evalJs(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
  mobileOverflows[t] = m;
  if (t === 'profile') {
    const metrics = await cdp('Page.getLayoutMetrics');
    const h = Math.min(Math.ceil(metrics.contentSize.height), 2600);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: h, deviceScaleFactor: 1, mobile: true });
    await new Promise(r => setTimeout(r, 150));
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, '06_mobile_profile.png'), Buffer.from(data, 'base64'));
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  }
}
console.log('5. MOBILE 390px OVERFLOW CHECK:', mobileOverflows);
for (const [t, m] of Object.entries(mobileOverflows)) {
  if (m.scrollWidth > m.innerWidth) {
    throw new Error(`Mobile horizontal overflow on tab ${t}: scrollWidth=${m.scrollWidth} > innerWidth=${m.innerWidth}`);
  }
}

console.log('CONSOLE ERRORS:', consoleErrors);
console.log('PAGE ERRORS:', pageErrors);

ws.close();
chrome.kill();
server.close();
if (consoleErrors.length || pageErrors.length) process.exit(1);
