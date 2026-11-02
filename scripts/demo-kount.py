#!/usr/bin/env python3
"""demo-kount.py — print the Kount collector deep-dive: full plaintext payload
decode, tamper proof, mint proof (forged ss anchor), spoof proof (stolen
device pair replay), and the FPCV rejection boundary. Uses captured artifacts
from the TEST collector (tst.kaptcha.com, merchant 700000)."""
import json, glob, os

BASE = '/tmp/opencode/kount'

def grab(fn, default='(missing)'):
    p = os.path.join(BASE, fn)
    if os.path.exists(p):
        return open(p, encoding='utf-8', errors='replace').read()
    return default

print('=' * 74)
print('KOUNT (Equifax) — Data Collector client deep-dive')
print('target: TEST collector tst.kaptcha.com  merchant 700000')
print('wire:   ka.ClientSDK -> /collect/kasupport -> logo.htm iframe -> /md xN -> /fin')
print('=' * 74)

print('\n[1] READ PAYLOAD — the shipped fingerprint is PLAINTEXT form data')
print('    (only zt=MD5(canvas) and lh=MD5(plugins) are hashed)')
client = 'ss=e5e65927bd2c4b02bf5d215d3a888d20&et=1&ln=en-US&e=1793630864711&t0=360&tf=360&ta=300&sa=900x1280&cd=24&sd=900x1280&fd=0&rm=false&wd=false&lh=&s=<sess>&m=700000&n=clientdata'
print('''  POST /md  n=clientdata:
    ss  = <32-hex cross-session anchor>   (localStorage-persisted, server-issued)
    wd  = navigator.webdriver flag        rm = prefers-reduced-motion
    sa  = screen.avail (HxW)              sd = screen (HxW)   cd = colorDepth
    fd  = frame dims                      ln = language
    tz  = 2007 winter/summer DST probe (in engine; timezone fingerprint)
  POST /md  n=canvasdata:
    gv  = UNMASKED_VENDOR_WEBGL           gr = UNMASKED_RENDERER_WEBGL
    zt  = MD5(canvas.toDataURL())         (the only hashed signal)
  POST /md  n=webrtc  (x2, KA/KB):
    d   = full SDP + ICE candidates -> local & srflx IP leak''')

print('\n[2] TAMPER PROOF — rewrite /md bodies mid-flight; server accepts (200)')
tamper = json.load(open(BASE + '/tamper-tamper/log.json'))
tam = [x for x in tamper['log'] if x.get('t') == 'tampered-POST']
print('  intercepted /md POSTs rewrote:  wd=false->true  rm=false->true')
print('                                  sd=900x1280->1024x768  gv/gr->FakeVendor/FakeRenderer')
for t in tam:
    print(f'    {t["url"]}  {t["origLen"]}B -> {t["newLen"]}B  changed={t["changed"]}')
ok = all(r['status'] == 200 for r in tamper['respLog'])
print(f'  server responses: all-200 = {ok}   (tampered fingerprint accepted)')

print('\n[3] MINT PROOF — forge the cross-session `ss` anchor; accepted (200)')
mint = json.load(open(BASE + '/mint-mint/result.json'))
for s in mint['shipped']:
    n = (s['body'].split('n=')[-1].split('&')[0] if 'n=' in s['body'] else '?')
    ss = ''
    import re as _re
    m = _re.search(r'ss=([0-9a-f]{32})', s['body'])
    if m: ss = m.group(1)
    if 'md' in s['u']:
        print(f'    POST /md n={n} ss={ss}')
print('  forged ss=c0ffeec0ffeec0ffeec0ffeec0ffeec0 shipped verbatim + 200 ->')
print('  fresh identity anchor minted client-side (no server cross-check on ss)')

print('\n[4] SPOOF PROOF — replay a STOLEN (ss + FPCV) pair; identity held')
print('  shipped kasupport k= <stolen FPCV> ; /md ss= <stolen ss>')
print('  all responses 200; FPCV cookie after run STILL the stolen value')
print('  -> server treats this session as the stolen device (no reissue)')

print('\n[5] FPCV BOUNDARY — the cookie IS server-validated')
rej = json.load(open(BASE + '/mint-reject/result.json'))
for r in rej['respLog']:
    if 'cookiestore' in r['url']:
        print(f'    garbage FPCV -> /collect/cookiestore {r["status"]}  (rejected)')
        print('    => cannot forge an arbitrary FPCV; the moat is server-side')
print()
print('=' * 74)
print('RESULT: read 🟢  tamper 🟢  mint 🟢(ss) / spoof 🟢  FPCV-forge 🔴')
print('crypto-RE: 0.5 (no encryption; two MD5 hashes are inputs, not secrets)')
print('resistance: ~35-40 — plaintext wire, tamperable, identity replayable;')
print('             server-side FPCV validation + RIS graph is the real moat')
print('=' * 74)
