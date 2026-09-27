"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  PartnerIQ: () => PartnerIQ,
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var VERSION = "0.2.0";
var ANON_KEY = "pi_anon_id";
var CLICK_KEY = "pi_click_id";
var state = null;
var PartnerIQ = {
  init(options) {
    if (!options.publicKey) throw new Error("PartnerIQ publicKey is required");
    if (/^(pi_|sk_)(test|live)_/.test(options.publicKey) && !/pk_/.test(options.publicKey)) {
      throw new Error("Secret API keys cannot be used with @partneriq-io/browser - use a public tracking key");
    }
    state = {
      publicKey: options.publicKey,
      apiUrl: (options.apiUrl || "http://localhost:3000").replace(/\/$/, ""),
      referralParams: options.referralParams || ["pi_ref", "ref", "via"],
      cookieDays: options.cookieDays || 30
    };
    return PartnerIQ;
  },
  /**
   * Call once per page load. If the current page URL carries one of `referralParams`
   * (e.g. a merchant embeds the short code directly rather than routing through /r/:shortCode),
   * this records the click against the real backend and persists the resulting Click ID -
   * the durable, server-side attribution identifier - alongside the anonymous id.
   * If no referral param is present, it just returns whatever attribution state already exists
   * (e.g. set previously by a /r/:shortCode redirect).
   */
  async captureReferral() {
    const cfg = requireState();
    if (!isBrowser()) return PartnerIQ.getAttribution();
    const url = new URL(window.location.href);
    const shortCode = cfg.referralParams.map((param) => url.searchParams.get(param)).find(Boolean);
    if (!shortCode) return PartnerIQ.getAttribution();
    const response = await request("/api/v1/tracking/click", {
      publicKey: cfg.publicKey,
      shortCode,
      landingUrl: window.location.href,
      utmSource: url.searchParams.get("utm_source") || void 0,
      utmMedium: url.searchParams.get("utm_medium") || void 0,
      utmCampaign: url.searchParams.get("utm_campaign") || void 0,
      utmTerm: url.searchParams.get("utm_term") || void 0,
      utmContent: url.searchParams.get("utm_content") || void 0
    });
    if (response?.tracked && response.anonymousId) {
      const days = response.cookieMaxAgeMs ? response.cookieMaxAgeMs / 864e5 : cfg.cookieDays;
      writeValue(ANON_KEY, response.anonymousId, days);
      if (response.clickId) writeValue(CLICK_KEY, response.clickId, days);
    }
    return PartnerIQ.getAttribution();
  },
  /**
   * Links the current anonymous click to a real customer id (call at signup/login/checkout).
   * This is what makes attribution survive a later cookie deletion, or a purchase completed on a
   * different device - the backend durably associates customerExternalId with the click's
   * attribution record server-side.
   */
  async identify(options) {
    const cfg = requireState();
    const attribution = PartnerIQ.getAttribution();
    if (!attribution.anonymousId) return null;
    return request("/api/v1/tracking/identify", {
      publicKey: cfg.publicKey,
      anonymousId: attribution.anonymousId,
      customerExternalId: options.customerId
    });
  },
  getAttribution() {
    return {
      anonymousId: readValue(ANON_KEY),
      clickId: readValue(CLICK_KEY)
    };
  },
  /** The Click ID is the primary attribution identifier - pass it to your server (e.g. as a hidden
   * checkout field or a Cashfree/Razorpay order tag) so a server-to-server conversion call or
   * payment webhook can resolve attribution deterministically instead of by customer/anon matching. */
  getClickId() {
    return readValue(CLICK_KEY);
  },
  clearAttribution() {
    clearValue(ANON_KEY);
    clearValue(CLICK_KEY);
  }
};
async function request(path, body) {
  const cfg = requireState();
  const response = await fetch(`${cfg.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PartnerIQ-Client": "browser",
      "PartnerIQ-Client-Version": VERSION
    },
    body: JSON.stringify(body),
    credentials: "omit"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message || `PartnerIQ browser request failed with ${response.status}`);
  }
  return payload?.data ?? payload;
}
function requireState() {
  if (!state) throw new Error("PartnerIQ.init() must be called first");
  return state;
}
function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
function readValue(key) {
  if (!isBrowser()) return null;
  return readCookie(key) || localStorage.getItem(key);
}
function writeValue(key, value, days) {
  if (!isBrowser()) return;
  localStorage.setItem(key, value);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${key}=${encodeURIComponent(value)}; Max-Age=${Math.round(days * 86400)}; Path=/; SameSite=Lax${secure}`;
}
function clearValue(key) {
  if (!isBrowser()) return;
  localStorage.removeItem(key);
  document.cookie = `${key}=; Max-Age=0; Path=/; SameSite=Lax`;
}
function readCookie(key) {
  if (!isBrowser()) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
var index_default = PartnerIQ;
//# sourceMappingURL=index.cjs.map
