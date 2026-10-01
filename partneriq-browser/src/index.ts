export const VERSION = '1.1.0';

/** Production API. Override with `apiUrl` for a self-hosted or local backend. */
export const DEFAULT_API_URL = 'https://api.partneriq.in';

export interface PartnerIQBrowserOptions {
  /** Public browser key: `pi_test_pk_…` or `pi_live_pk_…`. Never a secret key. */
  publicKey: string;
  /** Defaults to https://api.partneriq.in. */
  apiUrl?: string;
  /**
   * Query params on your own pages that carry a PartnerIQ short code, for links
   * like https://acme.com/?ref=sarah that skip the /r/ redirect.
   * Default: ['pi_ref', 'ref', 'via'].
   */
  referralParams?: string[];
  /** Fallback lifetime of the attribution cookie in days (default 30). The program's own window wins when known. */
  cookieDays?: number;
  /** Share attribution across subdomains, e.g. '.acme.com'. Defaults to the current host only. */
  cookieDomain?: string;
  /** Remove pi_click_id / pi_anon_id from the address bar after reading them (default true). */
  cleanUrl?: boolean;
  /** Request timeout in milliseconds (default 8000). */
  timeout?: number;
}

export interface IdentifyOptions {
  /** Your customer id: the same value you later send as customerExternalId. */
  customerId: string;
}

export interface Attribution {
  /** Visitor id; links the click to a customer via identify(). */
  anonymousId: string | null;
  /** The click that referred this visitor. Send it to your server with the order. */
  clickId: string | null;
}

export class PartnerIQBrowserError extends Error {
  status: number;
  code: string;
  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'PartnerIQBrowserError';
    this.status = options.status || 0;
    this.code = options.code || 'PARTNERIQ_ERROR';
  }
}

type State = Required<Omit<PartnerIQBrowserOptions, 'cookieDomain'>> & { cookieDomain?: string };

// Same names the /r/:shortCode redirect appends to your destination URL, so a
// redirect click and an in-page ?ref= click converge on one identity.
const ANON_KEY = 'pi_anon_id';
const CLICK_KEY = 'pi_click_id';
const SEEN_PREFIX = 'pi_seen:';
// Ids come from the URL, so only well-formed values are ever stored.
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

let state: State | null = null;
let inflightCapture: Promise<Attribution> | null = null;

export const PartnerIQ = {
  VERSION,

  init(options: PartnerIQBrowserOptions) {
    const publicKey = typeof options?.publicKey === 'string' ? options.publicKey.trim() : '';
    if (!publicKey) throw new PartnerIQBrowserError('PartnerIQ publicKey is required', { code: 'MISSING_PUBLIC_KEY' });
    // A secret key in a browser bundle is readable by every visitor; refuse it outright.
    // Prefix only: the random part of a public key may itself contain "_sk_".
    if (/^(pi_(test|live)_sk_|sk_)/.test(publicKey)) {
      throw new PartnerIQBrowserError(
        'Secret API keys must never be used in the browser. Use a public key (pi_test_pk_… / pi_live_pk_…) and keep the secret key on your server.',
        { code: 'SECRET_KEY_IN_BROWSER' },
      );
    }
    if (!/^pi_(test|live)_pk_[A-Za-z0-9_-]+$/.test(publicKey) && !/^pi_pub_[A-Za-z0-9_-]+$/.test(publicKey)) {
      throw new PartnerIQBrowserError('Use a public key with the pi_test_pk_ or pi_live_pk_ prefix', { code: 'INVALID_PUBLIC_KEY' });
    }
    state = {
      publicKey,
      apiUrl: (options.apiUrl || DEFAULT_API_URL).replace(/\/+$/, ''),
      referralParams: options.referralParams?.length ? options.referralParams : ['pi_ref', 'ref', 'via'],
      cookieDays: options.cookieDays && options.cookieDays > 0 ? options.cookieDays : 30,
      cookieDomain: options.cookieDomain,
      cleanUrl: options.cleanUrl !== false,
      timeout: options.timeout && options.timeout > 0 ? options.timeout : 8000,
    };
    return PartnerIQ;
  },

  /**
   * Call once on every page load (it is cheap and safe to repeat).
   *
   * 1. A visitor arriving from a PartnerIQ link (/r/:shortCode) carries
   *    `pi_click_id` and `pi_anon_id` in the URL: they are stored first-party
   *    and removed from the address bar.
   * 2. A visitor arriving on `?ref=<shortCode>` (one of `referralParams`) is
   *    recorded as a click, once per page URL per browser session.
   * 3. Otherwise the attribution stored earlier is returned unchanged.
   *
   * Never throws for tracking failures; inspect the returned attribution instead.
   */
  async captureReferral(): Promise<Attribution> {
    const cfg = requireState();
    if (!isBrowser()) return PartnerIQ.getAttribution();
    if (inflightCapture) return inflightCapture;

    inflightCapture = (async () => {
      const url = new URL(window.location.href);

      const clickFromUrl = url.searchParams.get(CLICK_KEY);
      const anonFromUrl = url.searchParams.get(ANON_KEY);
      if (clickFromUrl && ID_PATTERN.test(clickFromUrl)) {
        writeValue(CLICK_KEY, clickFromUrl, cfg.cookieDays);
        if (anonFromUrl && ID_PATTERN.test(anonFromUrl)) writeValue(ANON_KEY, anonFromUrl, cfg.cookieDays);
        if (cfg.cleanUrl) stripParams(url, [CLICK_KEY, ANON_KEY]);
        return PartnerIQ.getAttribution();
      }

      const shortCode = cfg.referralParams.map((param) => url.searchParams.get(param)).find(Boolean);
      if (!shortCode || !/^[A-Za-z0-9_-]{1,64}$/.test(shortCode)) return PartnerIQ.getAttribution();

      // A reload or SPA re-render of the same landing URL is not a new click.
      const seenKey = `${SEEN_PREFIX}${shortCode}:${url.pathname}${url.search}`;
      if (sessionGet(seenKey)) return PartnerIQ.getAttribution();

      try {
        const response = (await request('/api/v1/tracking/click', {
          publicKey: cfg.publicKey,
          shortCode,
          anonymousId: PartnerIQ.getAnonymousId() || undefined,
          landingUrl: window.location.href.slice(0, 2000),
          utmSource: url.searchParams.get('utm_source') || undefined,
          utmMedium: url.searchParams.get('utm_medium') || undefined,
          utmCampaign: url.searchParams.get('utm_campaign') || undefined,
          utmTerm: url.searchParams.get('utm_term') || undefined,
          utmContent: url.searchParams.get('utm_content') || undefined,
        })) as { anonymousId?: string; clickId?: string; cookieMaxAgeMs?: number; tracked?: boolean } | null;

        sessionSet(seenKey, '1');
        if (response?.tracked && response.anonymousId && ID_PATTERN.test(response.anonymousId)) {
          const days = response.cookieMaxAgeMs ? response.cookieMaxAgeMs / 86_400_000 : cfg.cookieDays;
          writeValue(ANON_KEY, response.anonymousId, days);
          if (response.clickId && ID_PATTERN.test(response.clickId)) writeValue(CLICK_KEY, response.clickId, days);
        }
      } catch (error) {
        warn('Referral could not be recorded', error);
      }
      return PartnerIQ.getAttribution();
    })();

    try {
      return await inflightCapture;
    } finally {
      inflightCapture = null;
    }
  },

  /** Alias of captureReferral(), kept for code written against the 1.0 README. */
  trackReferral(): Promise<Attribution> {
    return PartnerIQ.captureReferral();
  },

  /**
   * Links this visitor's click to your customer id. Call after signup or login.
   * This is what keeps attribution when the cookie is later cleared or the
   * purchase happens on another device. Resolves to null when this visitor
   * has no PartnerIQ click to link.
   *
   * Rejects with PartnerIQBrowserError (status 400) if this click is already
   * linked to a different customer.
   */
  async identify(options: IdentifyOptions) {
    const cfg = requireState();
    const customerId = typeof options?.customerId === 'string' ? options.customerId.trim() : '';
    if (!customerId) throw new PartnerIQBrowserError('identify() requires a customerId', { code: 'MISSING_CUSTOMER_ID' });
    const anonymousId = PartnerIQ.getAnonymousId();
    if (!anonymousId) return null;
    return request('/api/v1/tracking/identify', {
      publicKey: cfg.publicKey,
      anonymousId,
      customerExternalId: customerId,
    });
  },

  getAttribution(): Attribution {
    return { anonymousId: readValue(ANON_KEY), clickId: readValue(CLICK_KEY) };
  },

  getAnonymousId(): string | null {
    return readValue(ANON_KEY);
  },

  /**
   * The Click ID is the primary attribution identifier. Send it to your server
   * with the order (a hidden checkout field, or Razorpay/Cashfree order notes)
   * and pass it as `clickId` when you create the conversion.
   */
  getClickId(): string | null {
    return readValue(CLICK_KEY);
  },

  /** Forget this visitor's attribution, e.g. when they withdraw tracking consent. */
  clearAttribution() {
    clearValue(ANON_KEY);
    clearValue(CLICK_KEY);
  },
};

type PartnerIQApiPayload = {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: { message?: string; code?: string };
  message?: string | string[];
  [key: string]: unknown;
};

async function request(path: string, body: unknown) {
  const cfg = requireState();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), cfg.timeout) : null;
  let response: Response;
  try {
    response = await fetch(`${cfg.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // No cookies or auth ever leave the merchant's page with this call.
      credentials: 'omit',
      // Lets the click be recorded even if the visitor navigates away immediately.
      keepalive: true,
      signal: controller?.signal,
    });
  } catch (error) {
    throw new PartnerIQBrowserError(
      controller?.signal.aborted ? `PartnerIQ request timed out after ${cfg.timeout}ms` : 'Could not reach PartnerIQ',
      { code: controller?.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  const payload = (await response.json().catch(() => null)) as PartnerIQApiPayload | null;
  if (!response.ok || payload?.success === false) {
    const message = payload?.error?.message || (Array.isArray(payload?.message) ? payload?.message.join('; ') : payload?.message);
    throw new PartnerIQBrowserError(message || `PartnerIQ request failed with HTTP ${response.status}`, {
      status: response.status,
      code: payload?.error?.code,
    });
  }
  return payload?.data ?? payload;
}

function requireState() {
  if (!state) throw new PartnerIQBrowserError('PartnerIQ.init() must be called first', { code: 'NOT_INITIALIZED' });
  return state;
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

// Storage can be unavailable (Safari private mode, blocked third-party
// storage, sandboxed iframes): every access degrades to "not stored".
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readValue(key: string): string | null {
  if (!isBrowser()) return null;
  const value = readCookie(key) || safe(() => window.localStorage.getItem(key), null);
  return value && ID_PATTERN.test(value) ? value : null;
}

function writeValue(key: string, value: string, days: number) {
  if (!isBrowser()) return;
  safe(() => window.localStorage.setItem(key, value), undefined);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const domain = state?.cookieDomain ? `; Domain=${state.cookieDomain}` : '';
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${Math.round(days * 86400)}; Path=/${domain}; SameSite=Lax${secure}`;
}

function clearValue(key: string) {
  if (!isBrowser()) return;
  safe(() => window.localStorage.removeItem(key), undefined);
  const domain = state?.cookieDomain ? `; Domain=${state.cookieDomain}` : '';
  document.cookie = `${key}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
}

function readCookie(key: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
  return match ? safe(() => decodeURIComponent(match[1]), null) : null;
}

function sessionGet(key: string) {
  return safe(() => window.sessionStorage.getItem(key), null);
}

function sessionSet(key: string, value: string) {
  safe(() => window.sessionStorage.setItem(key, value), undefined);
}

function stripParams(url: URL, params: string[]) {
  params.forEach((param) => url.searchParams.delete(param));
  safe(() => window.history.replaceState(window.history.state, '', url.toString()), undefined);
}

function warn(message: string, error: unknown) {
  if (typeof console !== 'undefined') console.warn(`[PartnerIQ] ${message}:`, error instanceof Error ? error.message : error);
}

export default PartnerIQ;
