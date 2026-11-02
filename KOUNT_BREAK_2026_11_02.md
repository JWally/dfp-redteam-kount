# Kount (Equifax) Data Collector — client break (2026-11-02)

Full writeup of the authorized red-team against Kount's **TEST** collector
(`tst.kaptcha.com`, merchant `700000`, public sandbox).

## 1. Delivery architecture

Kount's device data collection is a three-piece client:

1. **`ka.ClientSDK`** — 6 KB script from `GET /collect/sdk?m=<merchant>`.
   Creates the hidden `#ibody` iframe, reads the `cdn.<site>.<merchant>.ka.ck`
   FPCV cookie, POSTs it to `/collect/kasupport`.
2. **`/collect/kasupport` config script** — 2.2 KB of executable JS returned by
   the server. Carries the **server-issued FPCV value** and implements
   issue/echo/validate logic (`kaGetCookie(true)` reissues; a `500` from
   `/collect/cookiestore` triggers reissue).
3. **`/logo.htm` collector engine** — 24.5 KB same-origin iframe page with 5
   collection modules, ending in a `/fin` completion POST.

Flow observed (see `artifacts/capture-requests.json`):

```
GET  /collect/sdk?m=700000                     -> 6 KB ka.ClientSDK
POST /collect/kasupport  (m,s,kddcgid,kappid[&k=FPCV])
GET  /logo.htm?m=&s=&kddcgid=&kappid=          -> 24.5 KB engine
POST /md  n=clientdata                         (289 B)
POST /md  n=canvasdata                         (296 B)
POST /md  n=webrtc  i=KA / i=KB                (2× ~1.16 KB)
POST /fin  n=collect-end&com=true&et=2007      (163 B)
```

## 2. The shipped payload is plaintext

Every `/md` body is a plain `application/x-www-form-urlencoded` POST. Decoded:

| n= | fields | notes |
|---|---|---|
| `clientdata` | `ss` (32-hex anchor), `et`, `ln`, `e` (epoch), `t0/ta/tf` (timers), `sa` (screen avail), `sd` (screen), `cd` (colorDepth), `fd` (frame dims), `rm` (reduced motion), `wd` (webdriver), `lh` (MD5 of plugins) | timezone probe in engine: `getTimezoneOffset` sampled at Jan-2007 vs Jul-2007 |
| `canvasdata` | `gv` (UNMASKED_VENDOR_WEBGL), `gr` (UNMASKED_RENDERER_WEBGL), `zt` (MD5 of `canvas.toDataURL()`) | the only hashed device signal; MD5 is an input hash, not a secret |
| `webrtc` ×2 | `d` = full SDP, `i` = KA/KB | ICE candidates leak local IP + srflx public IP |
| `fin` | `s`, `m`, `n=collect-end`, `com=true`, `et` | completion marker |

Server-issued opaque identity values:

- **FPCV cookie** `cdn.bluesnap.700000.ka.ck` — 316 hex chars; value shipped
  to the browser *inside* the kasupport script; echoed (not reissued) when the
  client presents one.
- **`ss` anchor** — 32-hex, persisted in the collector's localStorage, shipped
  in every `clientdata` POST.

## 3. Tamper — accepted (200)

Intercepted the `/md` POSTs via CDP and rewrote the plaintext bodies
mid-flight (`scripts/knt-tamper.mjs`):

```
wd=false -> wd=true        rm=false -> rm=true
sd=900x1280 -> 1024x768    gv/gr -> FakeVendor / FakeRenderer
```

All collector responses stayed **200** (`artifacts/tamper-log.json`) — the
collector accepts a tampered fingerprint.

## 4. Mint / spoof — identity is client-replayable

- **Mint `ss`**: pre-seed the collector's localStorage with a forged 32-hex
  anchor (`c0ffeec0ffeec0ffeec0ffeec0ffeec0`). The engine ships it verbatim in
  `/md n=clientdata`; server responds **200**. There is no client-side
  validation on `ss` (`artifacts/mint-result.json`).
- **Spoof full device**: present a stolen (ss + FPCV) pair from an earlier run.
  The SDK ships `k=<stolen FPCV>` to kasupport and `ss=<stolen>` in `/md`; all
  responses **200**, and the FPCV cookie is **not reissued** — the server
  treats the session as the stolen device (`artifacts/spoof-result.json`,
  `spoof3-evidence-trail.txt`).
- **FPCV forge boundary**: a garbage FPCV is rejected — `/collect/cookiestore`
  returns **400** (`artifacts/reject-result.json`). The FPCV itself cannot be
  forged; the moat is server-side.
- **No `ss`↔FPCV linkage (cross-check)**: presenting an **FPCV from device A
  with an `ss` from a different device B** is accepted (all 200,
  `scripts/knt-crosscheck.mjs`). The two client-asserted identities are
  collected independently — the collector does not cross-check them.

## 5. Assessment

- **Crypto-RE: 0.5** — no encryption anywhere; two MD5 hashes (`zt`, `lh`) are
  hashes of collected inputs, not secrets; the opaque values (FPCV, `ss`) are
  server-issued identity tokens.
- **Resistance: ~35-40** — plaintext wire, tamperable mid-flight, `ss` anchor
  mintable, device identity replayable; the real moat is the server-side FPCV
  validation (400 on garbage) + the RIS/persona graph, which we did not assess
  (no merchant RIS credentials).

## Scope note

TEST collector, public demo merchant only. No customer/prod traffic; no
production `ssl.kaptcha.com` collection beyond a single SDK fetch for shape.
Findings stated honestly, never overstated.
