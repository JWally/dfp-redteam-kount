#!/usr/bin/env node
/** knt-capture2.mjs — full-body capture of the Kount TEST collector flow
 *  (saves complete response bodies: logo.htm engine, kasupport JS, md replies)
 *  and dumps the FPCV device cookie. Run twice to compare FPCV stability. */
import { chromium } from 'playwright';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';

const TST = { host: 'tst.kaptcha.com', ip: '44.240.88.212' };
const MERCHANT = '700000';
const tag = process.argv[2] || 'a';
const OUT = `/tmp/opencode/kount/cap2-${tag}`;
mkdirSync(OUT, { recursive: true });

const srv = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
<script src="https://${TST.host}/collect/sdk?m=${MERCHANT}"></script>
<script>new ka.ClientSDK().collectData();</script>
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

const bodies = {};
let seq = 0;
page.on('response', async (res) => {
  const u = res.url();
  if (!u.includes('kaptcha.com')) return;
  try {
    const buf = await res.body();
    const fname = `${String(seq++).padStart(3, '0')}-${res.status()}-${u.replace(/^https:\/\//, '').replace(/[?&].*$/, '').replace(/\//g, '_')}`;
    bodies[fname] = { url: u, type: res.headers()['content-type'] || '', len: buf.length };
    writeFileSync(`${OUT}/${fname}`, buf);
    if (/logo\.htm|kasupport|\.js/.test(u)) {
      console.log(`saved ${buf.length}B ${fname}`);
    }
  } catch (_) {}
});

const reqLog = [];
page.on('request', (req) => {
  const u = req.url();
  if (!u.includes('kaptcha.com')) return;
  let body = null; try { body = req.postData(); } catch (_) {}
  reqLog.push({ m: req.method(), u: u.slice(0, 200), body });
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(25000);
try { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); } catch (_) {}
await page.waitForTimeout(3000);

const state = await page.evaluate(() => ({
  cookie: document.cookie,
  sessionId: ka.sessionId,
  host: ka.host,
})).catch(e => ({ err: String(e).slice(0, 150) }));

writeFileSync(`${OUT}/state.json`, JSON.stringify(state, null, 2));
writeFileSync(`${OUT}/requests.json`, JSON.stringify(reqLog, null, 2));
console.log('\nFPCV cookie:', (state.cookie || '').match(/cdn\.[^=]+=([^;]+)/)?.[1]?.slice(0, 80) || '(none)');
console.log('sessionId:', state.sessionId);
srv.close(); await b.close();
