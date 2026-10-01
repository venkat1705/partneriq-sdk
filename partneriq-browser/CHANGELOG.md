# Changelog

## 1.1.0

### Fixed
- `captureReferral()` now reads `pi_click_id` / `pi_anon_id` that the `/r/:shortCode` redirect appends to your landing URL. Visitors arriving from a PartnerIQ link were previously not attributed in the browser.
- The visitor's existing anonymous id is sent with `?ref=` clicks, so one visitor keeps one identity.
- A reload or SPA re-render of the same landing URL no longer records a second click.
- `trackReferral()` (documented in the 1.0 README) exists, as an alias of `captureReferral()`.
- The default `apiUrl` is the production API (`https://api.partneriq.in`).
- The ESM build is now `dist/index.mjs`, so SSR frameworks importing the package under Node.js no longer fail.

### Added
- `getAnonymousId()`, `cookieDomain` (share attribution across subdomains), `cleanUrl`, `timeout`.
- A CDN build at `dist/partneriq.min.js` (global `PartnerIQBrowser`).
- `PartnerIQBrowserError` with `status` and `code`.

### Security
- Any key with a secret prefix (`pi_*_sk_`, `sk_`) is refused. The 1.0 check could accept a secret key whose random part happened to contain `pk_`.
- Ids read from the URL or storage are validated before they are stored or sent.
- `pi_click_id` / `pi_anon_id` are removed from the address bar after capture, so they do not leak through shared links or `Referer`.
- Requests never send cookies (`credentials: 'omit'`) and time out after 8s.
- Storage failures (private mode, blocked storage) no longer throw.

## 1.0.1

- Initial public release.
