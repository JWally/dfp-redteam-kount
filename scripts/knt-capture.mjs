#!/usr/bin/env node
/** knt-capture.mjs — drive Kount's REAL hosted ka.ClientSDK (merchant 700000,
 *  TEST collector tst.kaptcha.com) and capture the ENTIRE shipped payload flow:
 *  /collect/sdk -> /collect/kasupport -> /logo.htm iframe -> collector posts -> /fin.
 *  Hosts are pinned via --host-resolver-rules because the sandbox DNS can't
 *  resolve kaptcha.com (collector ELB IPs resolved via DNS-over-HTTPS). */
import { chromium } from 'playwright';
import http from 'node:http';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const TST = { host: 'tst.kaptcha.com', ip: '44.240.88.212' };   // colle-elast ELB (us-west-2)
const SSL = { host: 'ssl.kaptcha.com', ip: '35.80.101.90' };
const MERCHANT = '700000';
const OUT = '/tmp/opencode/kount/cap';
mkdirSync(OUT, { recursive: true });

// --- local page that loads the real hosted SDK and kicks collection ---
const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><title>kount probe</title></head>
<body>
<script src="https://${TST.host}/collect/sdk?m=${MERCHANT}"></script>
<script>
  window.__kt = { reqs: [], fps: {} };
  (function(){
    const client = new ka.ClientSDK();
    window.__client = client;
    client.setupCallback({
      'collect-begin': (p) => { window.__kt.begin = p; },
      'collect-end':   (p) => { window.__kt.end   = p; },
    });
    client.collectData();
  })();
</script>
</body></html>`);
});

await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const b = await chromium.launch({
  headless: true,
  args: [
    `--host-resolver-rules=MAP ${TST.host} ${TST.ip}, MAP ${SSL.host} ${SSL.ip}, MAP kaptcha.com ${SSL.ip}`,
    '--disable-blink-features=AutomationControlled',
  ],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const reqs = [];
page.on('request', async (req) => {
  const u = req.url();
  if (!u.includes('kaptcha.com')) return;
  let body = null;
  try { body = req.postData(); } catch (_) {}
  const rec = { t: Date.now(), m: req.method(), u: u.slice(0, 220), bodyLen: body ? body.length : 0, body: body };
  reqs.push(rec);
});
page.on('response', async (res) => {
  const u = res.url();
  if (!u.includes('kaptcha.com')) return;
  const type = res.headers()['content-type'] || '';
  let size = 0, head = '';
  try { const buf = await res.body(); size = buf.length; head = buf.slice(0, 400).toString('latin1'); } catch (_) {}
  reqs.push({ t: Date.now(), resp: true, status: res.status(), type, u: u.slice(0, 220), size, head });
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25000);

// snapshot browser state
const state = await page.evaluate(() => ({
  begin: window.__kt.begin || null,
  end: window.__kt.end || null,
  cookie: document.cookie,
  kddcgid: typeof kddcgid !== 'undefined' ? kddcgid : null,
  ka: { host: ka.host, merchantId: ka.merchantId, sessionId: ka.sessionId },
  iframes: [...document.querySelectorAll('iframe')].map(f => f.src),
})).catch(e => ({ evalErr: String(e).slice(0, 200) }));

// trigger unload to catch the /fin beacon
try { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); } catch (_) {}
await page.waitForTimeout(3000);

writeFileSync(`${OUT}/requests.json`, JSON.stringify(reqs, null, 2));
writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 2));

// write unique response bodies to files for analysis
let n = 0;
for (const r of reqs) {
  if (r.resp && (r.head || '').length > 0 && !r.u.includes('.gif') && !r.u.includes('.png')) {
    const fname = `${OUT}/body-${String(n++).padStart(3, '0')}.${(r.type || '').includes('json') ? 'json' : 'txt'}`;
    // re-fetch not possible; bodies captured via head only above. Save head.
    writeFileSync(`${fname}.head`, r.head);
  }
}

console.log('=== KOUNT COLLECTOR CAPTURE (TEST) ===');
console.log(`merchant=${MERCHANT} collector=${TST.host}`);
console.log('--- kaptcha.com requests ---');
for (const r of reqs) {
  if (r.resp) console.log(`  RESP ${r.status} ${r.size}B [${r.type}] ${r.u}`);
  else console.log(`  ${r.m} ${r.u} ${r.bodyLen ? `body=${r.bodyLen}B` : ''}`);
}
console.log('\n--- browser state ---');
console.log(JSON.stringify(state, null, 2).slice(0, 1500));
srv.close(); await b.close();
