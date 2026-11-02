# Live deployments — Kount / ClearSale / NoFraud (2026-11-02)

Where these three vendors are actually deployed, found from **public** sources:
the urlscan.io public search API (30-day window) plus direct page fetches.
Only public page loads; no customer/prod interaction, no vendor endpoints
called beyond what a normal visitor triggers.

## Method

- urlscan.io search for each vendor's client host, e.g.
  `q=ssl.kaptcha.com/collect/sdk`, `q=device.clearsale.com.br`,
  `q=services.nofraud.com` → recent scan UUIDs + page domains.
- Direct fetch of each domain's page and grep for the vendor snippet + ID.

## Kount (Equifax) — `ssl.kaptcha.com`

**~1,325 scans in 30 days** (a large footprint). Live pages observed include:

| site | notes |
|---|---|
| `my.equifax.ca/login` | **Equifax's own customer login** (Kount's parent) |
| `sertifi.com` | merchant `m=100170`; ships `kount360Client.min.js` + `kount-web-client-sdk.js` (SDK v2.2.2, `impl=module&repo=github`) |
| `bulletproof.com`, `mypatriotsupply.com` | e-commerce checkouts |
| `explodely.com` | hosted checkout |
| `sarafreika.com`, `ozonebenefits.mx`, `oferten.com.mx`, `homohabilis.mx`, `lotherington.mx`, `harmand.com.mx` | Shopify-adjacent stores |

**The Kount merchant ID is public:** it rides in the clear in the SDK URL —
`ssl.kaptcha.com/collect/sdk?m=100170` — so any visitor (or scanner) can read
a merchant's Kount ID straight off the checkout page. Kount now clearly runs
the modern **client-hosted** `kount-web-client-sdk` (the same v2.2.x we
assessed), not only the legacy hosted `ka.ClientSDK`.

## ClearSale — `device.clearsale.com.br`

**~179 scans in 30 days, heavily Brazilian** (as expected — ClearSale is BR).

**Live production appkeys, extracted inline from page HTML** (they ride in the
clear in the loader snippet `csdp('app', '<key>')`):

| site | live appkey |
|---|---|
| `havaianas.com.br` | `32j1samy8kaepiyf7dqc` |
| `sephora.com.br` | `cf940e9b26` |
| `esfera.com.vc` (Santander rewards) | `9ov321577mqpmizuoe4q` |

Other observed deployments: `ultrafarma.com.br`, `miligrama.com.br`,
`lojadomecanico.com.br`, `rebecavernuccistore.com.br`, `fixferreterias.com`,
`nextingresso.com.br`, `lojaonlinetintasoliveira.com.br`, `bet593.ec`.

The appkey is just a public website identifier (used for `app=` in `fp1/fp2.png`
and cross-merchant attribution) — not a secret — but its public exposure, plus
the client-minted `ba`/`bb` identity and synthetic fingerprints we demonstrated,
means anyone can submit device data "as" one of these merchants' site tags.

## NoFraud → **Wyllo** — `services.nofraud.com`

**~4,900 scans in 30 days** (largest footprint of the three). Notable finding:
**NoFraud has rebranded to Wyllo** — its Shopify integration is the app block
`shopify://apps/wyllo-formerly-nofraud/blocks/nf_device/<uuid>`, and the device
script loads as:

```html
<script async src="https://services.nofraud.com/js/device.js?shop=<store>.myshopify.com"></script>
```

with a web-pixel config `{ "shopUrl": "<store>.myshopify.com",
"apiUrl": "https://services.nofraud.com", "eventPayloadVersion": "v1",
"runtimeContext": "STRICT" }`. The Shopify integration identifies the merchant
by the **`shop` parameter**, not the numeric `nofraud_user_id` (that form is the
legacy custom-integration path).

Live deployments observed: `lovefromjanet.com`, `zeitbike.com`, `medshop.com`,
`roygbiv.world`, `richclassdecor.com`, `yourpawadventures.com`, `iosgods.com`.

## Takeaways

- All three ship their **site/merchant identifiers in the clear** on customer
  pages (Kount `?m=`, ClearSale `csapp` inline, NoFraud `?shop=`/`nofraud_user_id`).
  These are not secrets, but they let anyone attribute traffic to a merchant.
- Adoption skew: **Kount** = largest + enterprise-heavy (Equifax dogfoods it);
  **ClearSale** = Brazil-centric retail/fintech; **NoFraud/Wyllo** = long tail
  of Shopify stores (hence the largest scan count).
- Kount has clearly moved to the **client-hosted Web SDK** we assessed, so the
  findings (plaintext `/md`, mintable `ss`, replayable device pair) apply to
  these production deployments, not just the TEST collector.
