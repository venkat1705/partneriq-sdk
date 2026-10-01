# @partneriq-io/browser

Lightweight first-party attribution for [PartnerIQ](https://partneriq.in). It records which partner referred a visitor and links that visitor to your customer at signup, so the conversion you later send from your server is credited correctly.

- Under 3 KB gzipped, no dependencies, safe to import in SSR (Next.js, Remix, Nuxt)
- First-party storage only: `SameSite=Lax` cookies plus `localStorage`, and no cookies are ever sent to PartnerIQ
- Never trusted for money: conversions are created server-side with [`@partneriq-io/node`](https://www.npmjs.com/package/@partneriq-io/node)

**Full documentation:** https://docs.partneriq.in/docs/sdk/browser

## Install

```bash
npm install @partneriq-io/browser
```

Or from a CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@partneriq-io/browser@1/dist/partneriq.min.js"></script>
<script>
  PartnerIQBrowser.PartnerIQ.init({ publicKey: 'pi_live_pk_…' }).captureReferral();
</script>
```

## Quickstart

```ts
import { PartnerIQ } from '@partneriq-io/browser';

PartnerIQ.init({ publicKey: process.env.NEXT_PUBLIC_PARTNERIQ_PUBLIC_KEY! });

// 1. On every page load:
await PartnerIQ.captureReferral();

// 2. After signup or login:
await PartnerIQ.identify({ customerId: user.id });

// 3. At checkout, send the click id to your server with the order:
const clickId = PartnerIQ.getClickId(); // then pass it as `clickId` in conversions.create
```

## Keys

Use only a **public** key: `pi_test_pk_…` or `pi_live_pk_…`. Create one under **Developers → API keys → Public browser keys** and list the domains your site runs on. Requests from any other origin are refused. `*.acme.com` matches every subdomain.

`init()` refuses secret keys (`pi_*_sk_…`) outright, because anything in a browser bundle is public.

## How a referral is captured

| The visitor arrives via | What `captureReferral()` does |
| --- | --- |
| A PartnerIQ link (`https://acme.partneriq.in/r/sarah`) | The redirect has already recorded the click and appended `pi_click_id` and `pi_anon_id` to your URL. The SDK stores them first-party and removes them from the address bar. |
| Your own URL with a code (`https://acme.com/?ref=sarah`) | Records the click with PartnerIQ and stores the returned ids. A reload of the same URL is not counted twice. |
| Neither | Returns whatever attribution was stored earlier. |

It never throws because tracking failed: an ad blocker or network error must not break your page. Inspect the returned `{ anonymousId, clickId }` instead.

## API

| Method | Description |
| --- | --- |
| `init(options)` | Configure once. Returns `PartnerIQ`. |
| `captureReferral()` / `trackReferral()` | Capture the referral for this page. Resolves to `{ anonymousId, clickId }`. |
| `identify({ customerId })` | Link the stored visitor to your customer id. Resolves to `null` when there is no PartnerIQ visitor to link. |
| `getAttribution()` | `{ anonymousId, clickId }` from storage. |
| `getClickId()` / `getAnonymousId()` | The individual ids, or `null`. |
| `clearAttribution()` | Forget the visitor, e.g. when consent is withdrawn. |

### Options

| Option | Default | |
| --- | --- | --- |
| `publicKey` | required | `pi_test_pk_…` / `pi_live_pk_…` |
| `apiUrl` | `https://api.partneriq.in` | |
| `referralParams` | `['pi_ref', 'ref', 'via']` | Query params on your pages that carry a short code |
| `cookieDays` | `30` | Fallback lifetime. The program's own cookie window wins when the API returns one. |
| `cookieDomain` | current host | e.g. `'.acme.com'` to share attribution between `www.` and `app.` |
| `cleanUrl` | `true` | Remove `pi_click_id` / `pi_anon_id` from the address bar after reading them |
| `timeout` | `8000` | ms |

## Privacy

The SDK stores two random identifiers (`pi_anon_id`, `pi_click_id`) and nothing else: no fingerprinting and no third-party cookies. If you run a consent banner, call `captureReferral()` once consent is given, and `clearAttribution()` if it is withdrawn.

## License

MIT
