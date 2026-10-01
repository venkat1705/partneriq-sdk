# @partneriq-io/node

Official Node.js SDK for [PartnerIQ](https://partneriq.in). Use it on your server to record conversions and refunds, link customers to the partner who referred them, manage tracking links, and verify signed webhooks.

- Node.js 18+ (uses the built-in `fetch`), ESM and CommonJS, full TypeScript types
- Automatic retries with idempotency, so a retried payment webhook never double-counts
- Zero runtime dependencies

**Full documentation:** https://docs.partneriq.in/docs/sdk/node

## Install

```bash
npm install @partneriq-io/node
```

## Quickstart

```ts
import { PartnerIQ } from '@partneriq-io/node';

const partneriq = new PartnerIQ({ apiKey: process.env.PARTNERIQ_SECRET_KEY! });

// When a payment succeeds:
const { conversion, commission } = await partneriq.conversions.create({
  externalId: order.id,            // your order id: also the idempotency key
  customerExternalId: user.id,     // your customer id
  amount: 49900,                   // ₹499.00 in paise
  currency: 'INR',
  clickId: order.partneriqClickId, // from PartnerIQ.getClickId() in the browser, if you have it
});
```

Amounts are always integers in the smallest currency unit (paise).

## API keys and environments

| Key prefix     | Environment | Use for                                    |
| -------------- | ----------- | ------------------------------------------ |
| `pi_test_sk_…` | Test Mode   | Development and staging. No real payouts.  |
| `pi_live_sk_…` | Live Mode   | Production.                                |

The environment comes from the key: a test key can never read or write live data. `partneriq.environment` tells you which one a client is using.

Secret keys are server-only. Never put one in a browser bundle, a mobile app, or a `NEXT_PUBLIC_` / `VITE_` variable. For the browser, use a public key (`pi_*_pk_…`) with [`@partneriq-io/browser`](https://www.npmjs.com/package/@partneriq-io/browser).

Each key carries scopes. A call outside the key's scopes fails with `PartnerIQPermissionError`. The default **Conversion tracking** preset covers conversions, refunds, identify and attach-order. Use **Full server integration** if you also manage tracking links and webhooks from code.

## Configuration

```ts
new PartnerIQ({
  apiKey: process.env.PARTNERIQ_SECRET_KEY!,
  baseUrl: 'https://api.partneriq.in', // default; http:// is only allowed for localhost
  timeout: 20_000,                     // per attempt, ms
  maxRetries: 2,                       // 0–5
  appInfo: { name: 'acme-billing', version: '3.2.0' }, // shows in PartnerIQ request logs
  fetch: customFetch,                  // optional: proxies, tracing, tests
});
```

## Resources

| Method | Endpoint | Scope |
| --- | --- | --- |
| `conversions.create(body, options?)` | `POST /api/v1/conversions` | `conversions:write` |
| `conversions.get(id)` | `GET /api/v1/conversions/:id` | `conversions:read` |
| `conversions.refund(id, body?, options?)` | `POST /api/v1/conversions/:id/refund` | `refunds:write` |
| `customers.identify({ customerId, anonymousId \| attributionId })` | `POST /api/v1/customers/identify` | `customers:write` |
| `attributions.attachOrder(body)` | `POST /api/v1/attributions/attach-order` | `attributions:write` |
| `trackingLinks.create(body)` | `POST /api/v1/tracking-links` | `tracking_links:write` |
| `trackingLinks.list(params?)` | `GET /api/v1/tracking-links` | `tracking_links:read` |
| `programs.list()` | `GET /api/v1/programs` | `programs:read` |
| `affiliates.get(id)` | `GET /api/v1/affiliates/:id` | `affiliates:read` |
| `webhooks.endpoints.create(body)` | `POST /api/v1/webhook-endpoints` | `webhooks:write` |
| `webhooks.endpoints.list()` | `GET /api/v1/webhook-endpoints` | `webhooks:read` |
| `webhooks.constructEvent(input)` | local, no network | none |

### Refunds

```ts
await partneriq.conversions.refund(order.id, {
  refundExternalId: refund.id, // makes the call safe to retry
  amount: 24900,               // omit for a full refund
  reason: 'Customer request',
});
```

Commission is clawed back in proportion to the refunded amount. Without a `refundExternalId` or `idempotencyKey` the call is not retried automatically, because repeating it could refund twice.

### Linking customers

Call `identify` at signup or login with the visitor id from the browser SDK. A later conversion is then credited to the right partner, even if the purchase happens after the cookie is gone or on another device.

```ts
await partneriq.customers.identify({ customerId: user.id, anonymousId: req.body.partneriqAnonymousId });
```

An attribution already linked to a different customer is never re-pointed. That case fails with `PartnerIQConflictError`.

## Idempotency and retries

- `conversions.create` uses `conversion:<externalId>` as its idempotency key unless you pass one.
- Retries cover HTTP 408, 429, 500, 502, 503, 504, timeouts and network errors. They apply to GETs and to writes that carry an idempotency key, use jittered exponential backoff, and honour `Retry-After`.
- Replaying a key returns the original response for 24 hours. Replaying it with a *different* payload fails with `PartnerIQConflictError`.

## Errors

Every error extends `PartnerIQError` and carries `status`, `code`, `requestId` (quote it to support) and `details`.

| Class | When |
| --- | --- |
| `PartnerIQValidationError` | 400/422, or invalid input caught before sending |
| `PartnerIQAuthenticationError` | 401: missing, invalid, revoked or expired key |
| `PartnerIQPermissionError` | 403: missing scope, or the key targets the other environment |
| `PartnerIQNotFoundError` | 404 |
| `PartnerIQConflictError` | 409: duplicate `externalId`, idempotency key reused with a new payload, taken short code |
| `PartnerIQRateLimitError` | 429 after retries (`retryAfter` in seconds) |
| `PartnerIQConnectionError` | No response: network failure, `code: 'TIMEOUT'`, or `'ABORTED'` |
| `PartnerIQApiError` | Any other non-2xx, such as a 5xx after retries |

```ts
import { PartnerIQConflictError } from '@partneriq-io/node';

try {
  await partneriq.conversions.create(payload);
} catch (err) {
  if (err instanceof PartnerIQConflictError) return; // already recorded
  throw err;
}
```

## Webhooks

PartnerIQ signs every delivery. Verify it against the **raw** request body before trusting it:

```ts
import express from 'express';
import { constructEvent, PartnerIQSignatureVerificationError } from '@partneriq-io/node';

app.post('/webhooks/partneriq', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = constructEvent({ rawBody: req.body, headers: req.headers, secret: process.env.PARTNERIQ_WEBHOOK_SECRET! });
  } catch (err) {
    if (err instanceof PartnerIQSignatureVerificationError) return res.sendStatus(400);
    throw err;
  }

  // Deliveries are at-least-once: skip ids you have already handled.
  if (await alreadyProcessed(event.id)) return res.sendStatus(200);
  await handle(event); // event.event === 'conversion.approved', event.data, ...
  res.sendStatus(200);
});
```

Next.js App Router: `const rawBody = await request.text()` and pass `headers: request.headers`.

- Each delivery carries the headers `PartnerIQ-Signature: v1=<hex>`, `PartnerIQ-Timestamp`, `PartnerIQ-Event`, `PartnerIQ-Event-Id`, `PartnerIQ-Delivery` and `PartnerIQ-Attempt`.
- Signatures older than 5 minutes are rejected (`toleranceSeconds`). Every retry is re-signed with a fresh timestamp.
- Respond with any 2xx within 5 seconds. Anything else is retried after 5m, 30m, 2h, 6h, 12h and 24h (7 attempts in total). Redirects are not followed.
- To rotate the signing secret with no downtime, pass `secret: [newSecret, oldSecret]`.

## Security checklist

- Keep `pi_*_sk_` keys in a secret manager and use one key per service, so a leaked key can be revoked on its own.
- Give each key the narrowest scope preset that works.
- Create conversions from your server, never from the browser.
- Verify every webhook, and de-duplicate on `event.id`.

## License

MIT
