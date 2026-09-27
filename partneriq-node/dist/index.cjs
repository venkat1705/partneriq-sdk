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
  PartnerIQApiError: () => PartnerIQApiError,
  PartnerIQAuthenticationError: () => PartnerIQAuthenticationError,
  PartnerIQConflictError: () => PartnerIQConflictError,
  PartnerIQError: () => PartnerIQError,
  PartnerIQRateLimitError: () => PartnerIQRateLimitError,
  PartnerIQValidationError: () => PartnerIQValidationError,
  default: () => index_default,
  verifyWebhookSignature: () => verifyWebhookSignature
});
module.exports = __toCommonJS(index_exports);
var import_node_crypto = require("node:crypto");
var VERSION = "0.1.0";
var PartnerIQError = class extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || "PARTNERIQ_ERROR";
    this.status = options.status || 0;
    this.requestId = options.requestId;
    this.details = options.details;
  }
};
var PartnerIQAuthenticationError = class extends PartnerIQError {
};
var PartnerIQValidationError = class extends PartnerIQError {
};
var PartnerIQRateLimitError = class extends PartnerIQError {
};
var PartnerIQConflictError = class extends PartnerIQError {
};
var PartnerIQApiError = class extends PartnerIQError {
};
var PartnerIQ = class {
  constructor(options) {
    this.conversions = {
      create: (body, options) => {
        const idempotencyKey = options?.idempotencyKey || (body.externalId ? `conversion:${body.externalId}` : void 0);
        return this.request("/api/v1/conversions", { method: "POST", body: JSON.stringify(body), idempotencyKey });
      },
      get: (id) => this.request(`/api/v1/conversions/${encodeURIComponent(id)}`),
      refund: (body, options) => this.request(`/api/v1/conversions/${encodeURIComponent(body.externalId)}/refund`, {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey: options?.idempotencyKey || (body.refundExternalId ? `refund:${body.refundExternalId}` : void 0)
      })
    };
    this.customers = {
      /** Durably links a customer to their anonymous click's attribution - call this at
       * signup/login/checkout so attribution survives cookie deletion or a purchase from
       * another device. Maps to the real POST /api/v1/tracking/identify endpoint. */
      identify: (body) => this.request("/api/v1/tracking/identify", {
        method: "POST",
        body: JSON.stringify({ publicKey: body.publicKey, anonymousId: body.anonymousId, customerExternalId: body.customerId })
      })
    };
    this.trackingLinks = {
      create: (body) => this.request(`/api/v1/organizations/${encodeURIComponent(body.organizationId)}/tracking-links`, {
        method: "POST",
        body: JSON.stringify(body)
      }),
      list: (organizationId, params) => this.request(`/api/v1/organizations/${encodeURIComponent(organizationId)}/tracking-links${this.query(params)}`)
    };
    this.programs = {
      list: (params) => this.request(`/api/v1/programs${this.query(params)}`)
    };
    this.affiliates = {
      get: (id) => this.request(`/api/v1/affiliates/${encodeURIComponent(id)}`)
    };
    this.webhooks = {
      endpoints: {
        create: (body) => this.request("/api/v1/webhook-endpoints", { method: "POST", body: JSON.stringify(body) }),
        list: () => this.request("/api/v1/webhook-endpoints")
      },
      verifySignature: verifyWebhookSignature
    };
    if (!options.apiKey) throw new PartnerIQAuthenticationError("PartnerIQ apiKey is required");
    if (!/^pi_(test|live)_sk_/.test(options.apiKey)) {
      throw new PartnerIQAuthenticationError("Use a secret key with pi_test_sk_ or pi_live_sk_ prefix");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || "http://localhost:3000").replace(/\/$/, "");
    this.timeout = options.timeout || 1e4;
    this.maxRetries = options.maxRetries ?? 2;
  }
  async request(path, config = {}) {
    const method = (config.method || "GET").toUpperCase();
    const idempotencyKey = config.idempotencyKey;
    const retryUnsafe = Boolean(idempotencyKey || config.retryUnsafe);
    let attempt = 0;
    for (; ; ) {
      try {
        return await this.fetchOnce(path, config, idempotencyKey);
      } catch (error) {
        const err = normalizeError(error);
        const retryableStatus = [429, 502, 503, 504].includes(err.status);
        const canRetry = attempt < this.maxRetries && retryableStatus && (method === "GET" || retryUnsafe);
        if (!canRetry) throw err;
        await sleep(backoff(attempt++));
      }
    }
  }
  async fetchOnce(path, config, idempotencyKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    const headers = new Headers(config.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("PartnerIQ-Client", "node");
    headers.set("PartnerIQ-Client-Version", VERSION);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...config, headers, signal: controller.signal });
      const requestId = response.headers.get("x-request-id") || void 0;
      const body = await parseBody(response);
      if (!response.ok) throw toPartnerIQError(response.status, body, requestId);
      return body?.data ?? body;
    } finally {
      clearTimeout(timeout);
    }
  }
  query(params) {
    if (!params) return "";
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value2]) => {
      if (value2 !== void 0) search.set(key, String(value2));
    });
    const value = search.toString();
    return value ? `?${value}` : "";
  }
};
function verifyWebhookSignature(input) {
  if (!input || typeof input !== "object") return false;
  if (!input.secret || typeof input.secret !== "string") return false;
  if (!input.signature || typeof input.signature !== "string") return false;
  if (typeof input.rawBody !== "string") return false;
  let timestamp = input.timestamp !== void 0 ? Number(input.timestamp) : NaN;
  let signature = input.signature.trim();
  if (signature.includes(",")) {
    const parts = signature.split(",");
    for (const part of parts) {
      const [k, v] = part.split("=");
      if (k && v) {
        if (k.trim() === "t" && Number.isNaN(timestamp)) timestamp = Number(v.trim());
        if (k.trim() === "v1") signature = v.trim();
      }
    }
  } else if (signature.startsWith("v1=")) {
    signature = signature.replace(/^v1=/, "");
  }
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1e3 - timestamp) > tolerance) {
    return false;
  }
  try {
    const expected = (0, import_node_crypto.createHmac)("sha256", input.secret).update(`${timestamp}.${input.rawBody}`).digest("hex");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && (0, import_node_crypto.timingSafeEqual)(left, right);
  } catch {
    return false;
  }
}
async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function toPartnerIQError(status, body, requestId) {
  const error = body?.error || {};
  const options = { code: error.code, status, requestId: error.requestId || requestId, details: error.details };
  if (status === 401) return new PartnerIQAuthenticationError(error.message || "Authentication failed", options);
  if (status === 400 || status === 422) return new PartnerIQValidationError(error.message || "Validation failed", options);
  if (status === 409) return new PartnerIQConflictError(error.message || "Conflict", options);
  if (status === 429) return new PartnerIQRateLimitError(error.message || "Rate limit exceeded", options);
  return new PartnerIQApiError(error.message || `PartnerIQ request failed with ${status}`, options);
}
function normalizeError(error) {
  if (error instanceof PartnerIQError) return error;
  const message = error instanceof Error ? error.message : "Network request failed";
  return new PartnerIQApiError(message, { code: "NETWORK_ERROR", status: 0 });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function backoff(attempt) {
  return Math.min(2e3, 150 * 2 ** attempt) + Math.floor(Math.random() * 100);
}
var index_default = PartnerIQ;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PartnerIQ,
  PartnerIQApiError,
  PartnerIQAuthenticationError,
  PartnerIQConflictError,
  PartnerIQError,
  PartnerIQRateLimitError,
  PartnerIQValidationError,
  verifyWebhookSignature
});
//# sourceMappingURL=index.cjs.map
