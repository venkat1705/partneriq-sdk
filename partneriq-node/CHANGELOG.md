# Changelog

## 1.1.0

### Fixed
- `trackingLinks.create` and `trackingLinks.list` now call the API-key routes (`/api/v1/tracking-links`). They previously called dashboard routes that reject API keys, so both always failed with 401.
- `customers.identify` now calls `POST /api/v1/customers/identify` with your secret key. It previously sent the secret key to the public browser endpoint. `publicKey` is no longer needed and is ignored if passed.
- The ESM build is now `dist/index.mjs`. `import { PartnerIQ } from '@partneriq-io/node'` failed under Node.js ESM in 1.0.x.
- The default `baseUrl` is the production API (`https://api.partneriq.in`), not `http://localhost:3000`.
- Validation errors are returned as rejected promises instead of thrown synchronously.

### Added
- `attributions.attachOrder()` for Razorpay / Cashfree / Juspay order linking.
- `webhooks.constructEvent()`: verifies a delivery and returns the typed event, throwing `PartnerIQSignatureVerificationError` on failure.
- Signature verification accepts a `Buffer` body and an array of secrets (for rotation).
- Typed responses (`Conversion`, `TrackingLink`, `Affiliate`, `WebhookEvent`…) and error classes `PartnerIQPermissionError` (403), `PartnerIQNotFoundError` (404), `PartnerIQConnectionError` (network/timeout).
- `environment` property derived from the key, `appInfo` and custom `fetch` options, per-call `timeout` and `signal`.

### Security
- `baseUrl` must be `https://` (plain `http://` is allowed only for localhost), so a secret key is never sent in cleartext.
- Redirects are refused, so the `Authorization` header is never sent on to another host.
- The API key no longer appears in `console.log(client)` or `JSON.stringify(client)`.
- A public browser key passed as `apiKey` is rejected with a clear message.

### Changed
- Retries now also cover network errors, timeouts, HTTP 408 and HTTP 500, use jittered exponential backoff, and honour `Retry-After`. As before, only GETs and writes carrying an idempotency key are retried.
- The default timeout is 20s (was 10s).

## 1.0.1

- Initial public release.
