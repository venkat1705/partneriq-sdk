import { createHmac, timingSafeEqual } from 'node:crypto';

export const VERSION = '1.1.0';

/** Production API. Override with `baseUrl` for a self-hosted or local backend. */
export const DEFAULT_BASE_URL = 'https://api.partneriq.in';

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface PartnerIQRequestOptions {
  /**
   * Makes a write safe to retry: PartnerIQ returns the original response for a
   * repeated key (24h window) and rejects a reused key whose payload differs.
   */
  idempotencyKey?: string;
  /** Per-call timeout in milliseconds, overriding the client default. */
  timeout?: number;
  /** Abort the request from your side (e.g. when an incoming HTTP request is cancelled). */
  signal?: AbortSignal;
}

export interface ConversionCreateRequest {
  /** Your unique order / transaction id. A second conversion with the same id is rejected. */
  externalId: string;
  /** Your customer id. Links this purchase to a click identified earlier. */
  customerExternalId: string;
  /** Amount in the smallest currency unit (paise for INR). Must be a positive integer. */
  amount: number;
  /** ISO 4217 code. Defaults to the platform currency (INR) when omitted. */
  currency?: string;
  type?: 'PURCHASE' | 'SUBSCRIPTION_RENEWAL' | (string & {});
  /** ISO-8601 time the purchase happened. Defaults to the time PartnerIQ receives it. */
  occurredAt?: string;
  /**
   * Preferred: the Click ID (`pi_click_id`) captured by the browser SDK or the
   * /r/:shortCode redirect. Resolves attribution deterministically.
   */
  clickId?: string;
  /** Legacy: an explicit attribution record id. Prefer clickId. */
  attributionId?: string;
  productId?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundCreateRequest {
  /** Your refund transaction id. Used to derive an idempotency key when none is given. */
  refundExternalId?: string;
  /** Partial refund amount in the smallest currency unit. Omit to refund the remaining balance. */
  amount?: number;
  reason?: string;
}

export type IdentifyCustomerRequest =
  | { customerId: string; anonymousId: string; attributionId?: never }
  | { customerId: string; attributionId: string; anonymousId?: never };

export interface AttachOrderRequest {
  attributionId: string;
  provider: 'RAZORPAY' | 'CASHFREE' | 'JUSPAY' | 'CUSTOM';
  externalOrderId: string;
  /** Amount in the smallest currency unit. */
  amount: number;
  currency: string;
}

export interface TrackingLinkCreateRequest {
  programId: string;
  affiliateId: string;
  destinationUrl: string;
  campaignId?: string;
  /** Vanity short code, e.g. "alex20". Must be unique within your organization. */
  customCode?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** @deprecated Ignored. The organization comes from the API key. */
  organizationId?: string;
}

export interface TrackingLinkListParams {
  programId?: string;
  affiliateId?: string;
  page?: number;
  /** 1-100, default 20. */
  limit?: number;
}

export type WebhookEventType =
  | 'affiliate.created'
  | 'affiliate.approved'
  | 'click.flagged'
  | 'conversion.created'
  | 'conversion.approved'
  | 'conversion.rejected'
  | 'conversion.refunded'
  | 'commission.created'
  | 'commission.approved'
  | 'commission.reversed'
  | 'payout.created'
  | 'payout.completed'
  | 'payout.failed'
  | 'payout.held'
  | 'payout.released';

export interface WebhookEndpointCreateRequest {
  /** Public HTTPS URL. Private, loopback and cloud-metadata addresses are rejected. */
  url: string;
  subscribedEvents: WebhookEventType[];
}

// ---------------------------------------------------------------------------
// Response types (fields PartnerIQ guarantees; records may carry more)
// ---------------------------------------------------------------------------

export interface Conversion {
  id: string;
  organizationId: string;
  programId?: string | null;
  affiliateId?: string | null;
  externalId: string;
  customerExternalId?: string | null;
  amount: number;
  currency: string;
  status: string;
  environment?: string;
  clickId?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface ConversionCreateResponse {
  conversion: Conversion;
  fraudResult?: Record<string, unknown> | null;
  commission?: Record<string, unknown> | null;
}

export interface IdentifyCustomerResponse {
  customerExternalId: string;
  updatedAttributions: number;
}

export interface AttachOrderResponse {
  attached: boolean;
  duplicate?: boolean;
  attributionId: string;
  provider?: string;
  externalOrderId?: string;
}

export interface TrackingLink {
  id: string;
  organizationId: string;
  programId: string;
  affiliateId: string;
  shortCode: string;
  shortUrl?: string | null;
  destinationUrl: string;
  campaignId?: string | null;
  status: string;
  environment?: 'test' | 'live';
  clicks?: number;
  conversions?: number;
  revenue?: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface Program {
  id: string;
  organizationId: string;
  name: string;
  status?: string;
  environment?: 'test' | 'live';
  [key: string]: unknown;
}

export interface Affiliate {
  id: string;
  organizationId: string;
  displayName: string;
  email: string;
  companyName: string | null;
  website: string | null;
  country: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  environment: 'test' | 'live';
  enabled?: boolean;
  subscribedEvents: WebhookEventType[];
  createdAt: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** Signing secret. Returned only once, at creation: store it in your secret manager. */
  secret: string;
}

export interface Page<T> {
  data: T[];
  meta?: { page?: number; limit?: number; total?: number; totalPages?: number; nextCursor?: string | null };
}

/** The JSON body PartnerIQ POSTs to your webhook endpoint. */
export interface WebhookEvent<T = Record<string, unknown>> {
  /** Stable per event, identical across retries: de-duplicate on this. */
  id: string;
  event: WebhookEventType;
  environment: 'test' | 'live';
  /** Unix seconds when the event was created (not when this attempt was sent). */
  timestamp: number;
  data: T;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PartnerIQError extends Error {
  code: string;
  /** HTTP status, or 0 when no response was received. */
  status: number;
  /** Quote this to PartnerIQ support. */
  requestId?: string;
  details?: unknown;

  constructor(message: string, options: { code?: string; status?: number; requestId?: string; details?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code || 'PARTNERIQ_ERROR';
    this.status = options.status || 0;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

/** 401: missing, invalid, revoked or expired API key. */
export class PartnerIQAuthenticationError extends PartnerIQError {}
/** 403: the key lacks a required scope, or targets the other environment. */
export class PartnerIQPermissionError extends PartnerIQError {}
/** 404: the resource does not exist in this key's organization and environment. */
export class PartnerIQNotFoundError extends PartnerIQError {}
/** 400 / 422: the request body failed validation. `details` carries field errors when available. */
export class PartnerIQValidationError extends PartnerIQError {}
/** 409: duplicate externalId, idempotency key reused with a different payload, or a taken short code. */
export class PartnerIQConflictError extends PartnerIQError {}
/** 429: slow down. Retried automatically up to `maxRetries`. */
export class PartnerIQRateLimitError extends PartnerIQError {
  /** Seconds the server asked us to wait, when provided. */
  retryAfter?: number;
}
/** No response: DNS, TLS, connection reset, or timeout (`code === 'TIMEOUT'`). */
export class PartnerIQConnectionError extends PartnerIQError {}
/** Any other non-2xx response (5xx after retries are exhausted). */
export class PartnerIQApiError extends PartnerIQError {}
/** Thrown by `webhooks.constructEvent` when a payload cannot be trusted. */
export class PartnerIQSignatureVerificationError extends PartnerIQError {}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface PartnerIQOptions {
  /** Secret key: `pi_test_sk_…` (Test Mode) or `pi_live_sk_…` (Live Mode). Server-side only. */
  apiKey: string;
  /** Defaults to https://api.partneriq.in. Plain http is accepted only for localhost. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds (default 20000). */
  timeout?: number;
  /** Retries for 429, 5xx and network failures on safe or idempotent requests (default 2, max 5). */
  maxRetries?: number;
  /** Custom fetch implementation (proxies, instrumentation, tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Identifies your integration in PartnerIQ logs, e.g. { name: 'acme-billing', version: '3.2.0' }. */
  appInfo?: { name: string; version?: string };
}

type RequestConfig = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  /** The endpoint de-duplicates on its own (e.g. by externalOrderId), so a retry is safe. */
  retryUnsafe?: boolean;
  timeout?: number;
  signal?: AbortSignal;
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const SECRET_KEY_PATTERN = /^pi_(test|live)_sk_[A-Za-z0-9_-]{16,}$/;
const keys = new WeakMap<PartnerIQ, string>();

export class PartnerIQ {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  /** Derived from the key prefix: every call is scoped to this environment. */
  readonly environment: 'test' | 'live';
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  readonly conversions = {
    /**
     * Records a purchase. Attribution, fraud screening and commission are
     * resolved server-side. Safe to retry: the idempotency key defaults to
     * `conversion:<externalId>`.
     */
    create: async (body: ConversionCreateRequest, options: PartnerIQRequestOptions = {}): Promise<ConversionCreateResponse> => {
      requireString(body?.externalId, 'externalId');
      requireString(body?.customerExternalId, 'customerExternalId');
      requirePositiveInteger(body?.amount, 'amount');
      return this.request('/api/v1/conversions', {
        method: 'POST',
        body,
        idempotencyKey: options.idempotencyKey || `conversion:${body.externalId}`,
        timeout: options.timeout,
        signal: options.signal,
      });
    },

    /** Fetches a conversion by PartnerIQ id or by your externalId. */
    get: async (id: string, options: PartnerIQRequestOptions = {}): Promise<Conversion> => {
      requireString(id, 'id');
      return this.request(`/api/v1/conversions/${encodeURIComponent(id)}`, options);
    },

    /**
     * Refunds a conversion fully or partially and claws back commission
     * proportionally. Pass a refundExternalId (or an idempotencyKey) so a retry
     * can never refund twice; without one the call is not retried.
     */
    refund: async (
      conversionIdOrLegacyBody: string | (RefundCreateRequest & { externalId: string }),
      bodyOrOptions?: RefundCreateRequest | PartnerIQRequestOptions,
      maybeOptions?: PartnerIQRequestOptions,
    ): Promise<Record<string, unknown>> => {
      // 1.0 signature: refund({ externalId, ...refund }, options)
      const legacy = typeof conversionIdOrLegacyBody !== 'string';
      const id = legacy ? conversionIdOrLegacyBody.externalId : conversionIdOrLegacyBody;
      const body: RefundCreateRequest = legacy
        ? pick(conversionIdOrLegacyBody, ['refundExternalId', 'amount', 'reason'])
        : ((bodyOrOptions as RefundCreateRequest) || {});
      const options = ((legacy ? bodyOrOptions : maybeOptions) || {}) as PartnerIQRequestOptions;
      requireString(id, 'conversion id');
      if (body.amount !== undefined) requirePositiveInteger(body.amount, 'amount');
      return this.request(`/api/v1/conversions/${encodeURIComponent(id)}/refund`, {
        method: 'POST',
        body,
        idempotencyKey: options.idempotencyKey || (body.refundExternalId ? `refund:${body.refundExternalId}` : undefined),
        timeout: options.timeout,
        signal: options.signal,
      });
    },
  };

  readonly customers = {
    /**
     * Links an anonymous visitor (or a specific attribution) to your customer id,
     * so a later conversion is credited even after cookies are cleared or the
     * purchase happens on another device. Call it at signup or login.
     */
    identify: async (body: IdentifyCustomerRequest & { publicKey?: string }, options: PartnerIQRequestOptions = {}): Promise<IdentifyCustomerResponse> => {
      requireString(body?.customerId, 'customerId');
      if (!body.anonymousId === !body.attributionId) {
        throw new PartnerIQValidationError('Provide exactly one of anonymousId or attributionId', { code: 'INVALID_REQUEST' });
      }
      return this.request('/api/v1/customers/identify', {
        method: 'POST',
        // `publicKey` (1.0) is not needed: the secret key already identifies the organization.
        body: { customerId: body.customerId, anonymousId: body.anonymousId, attributionId: body.attributionId },
        retryUnsafe: true, // re-linking the same customer is a no-op
        timeout: options.timeout,
        signal: options.signal,
      });
    },
  };

  readonly attributions = {
    /**
     * Ties a payment-provider order (Razorpay, Cashfree, Juspay…) to an
     * attribution before the payment completes. Repeating the same
     * externalOrderId is a no-op, so the call is retried safely.
     */
    attachOrder: async (body: AttachOrderRequest, options: PartnerIQRequestOptions = {}): Promise<AttachOrderResponse> => {
      requireString(body?.attributionId, 'attributionId');
      requireString(body?.externalOrderId, 'externalOrderId');
      requirePositiveInteger(body?.amount, 'amount');
      return this.request('/api/v1/attributions/attach-order', {
        method: 'POST',
        body,
        retryUnsafe: true,
        timeout: options.timeout,
        signal: options.signal,
      });
    },
  };

  readonly trackingLinks = {
    create: async (body: TrackingLinkCreateRequest, options: PartnerIQRequestOptions = {}): Promise<TrackingLink> => {
      requireString(body?.programId, 'programId');
      requireString(body?.affiliateId, 'affiliateId');
      requireString(body?.destinationUrl, 'destinationUrl');
      const { organizationId: _ignored, ...payload } = body;
      return this.request('/api/v1/tracking-links', {
        method: 'POST',
        body: payload,
        idempotencyKey: options.idempotencyKey,
        timeout: options.timeout,
        signal: options.signal,
      });
    },

    /** Lists links in the key's organization and environment, newest first. */
    list: (
      paramsOrLegacyOrgId?: TrackingLinkListParams | string,
      legacyParams?: TrackingLinkListParams,
    ): Promise<Page<TrackingLink>> => {
      // 1.0 signature: list(organizationId, params)
      const params = typeof paramsOrLegacyOrgId === 'string' ? legacyParams : paramsOrLegacyOrgId;
      return this.request('/api/v1/tracking-links', { query: { ...params } }, { raw: true });
    },
  };

  readonly programs = {
    list: (): Promise<Page<Program>> => this.request('/api/v1/programs', {}, { raw: true }),
  };

  readonly affiliates = {
    get: async (id: string, options: PartnerIQRequestOptions = {}): Promise<Affiliate> => {
      requireString(id, 'id');
      return this.request(`/api/v1/affiliates/${encodeURIComponent(id)}`, options);
    },
  };

  readonly webhooks = {
    endpoints: {
      /** The response includes the signing `secret` exactly once. */
      create: async (body: WebhookEndpointCreateRequest, options: PartnerIQRequestOptions = {}): Promise<WebhookEndpointWithSecret> => {
        requireString(body?.url, 'url');
        if (!Array.isArray(body.subscribedEvents) || !body.subscribedEvents.length) {
          throw new PartnerIQValidationError('subscribedEvents must list at least one event', { code: 'INVALID_REQUEST' });
        }
        return this.request('/api/v1/webhook-endpoints', {
          method: 'POST',
          body,
          idempotencyKey: options.idempotencyKey,
          timeout: options.timeout,
          signal: options.signal,
        });
      },
      list: (): Promise<WebhookEndpoint[]> => this.request('/api/v1/webhook-endpoints'),
    },
    verifySignature: verifyWebhookSignature,
    constructEvent,
  };

  constructor(options: PartnerIQOptions) {
    if (!options || typeof options.apiKey !== 'string' || !options.apiKey) {
      throw new PartnerIQAuthenticationError('PartnerIQ apiKey is required', { code: 'MISSING_API_KEY' });
    }
    const apiKey = options.apiKey.trim();
    if (/^pi_(test|live)_pk_/.test(apiKey)) {
      throw new PartnerIQAuthenticationError(
        'This is a public browser key. The Node SDK needs a secret key (pi_test_sk_… or pi_live_sk_…); use the public key with @partneriq-io/browser.',
        { code: 'WRONG_KEY_TYPE' },
      );
    }
    const match = SECRET_KEY_PATTERN.exec(apiKey);
    if (!match) {
      throw new PartnerIQAuthenticationError('Use a secret key with the pi_test_sk_ or pi_live_sk_ prefix', { code: 'INVALID_API_KEY_FORMAT' });
    }
    keys.set(this, apiKey);
    this.environment = match[1] as 'test' | 'live';
    this.baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
    this.timeout = positiveOr(options.timeout, 20_000);
    this.maxRetries = Math.min(5, Math.max(0, Math.floor(options.maxRetries ?? 2)));
    const fetchImpl = options.fetch || (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchImpl) {
      throw new PartnerIQError('No fetch implementation found. Use Node.js 18+ or pass options.fetch.', { code: 'FETCH_UNAVAILABLE' });
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
    const app = options.appInfo?.name ? ` ${options.appInfo.name}${options.appInfo.version ? `/${options.appInfo.version}` : ''}` : '';
    this.userAgent = `partneriq-node/${VERSION} node/${process.versions?.node || 'unknown'}${app}`;
  }

  /**
   * Low-level escape hatch for endpoints without a typed helper. Returns the
   * response's `data` (or `{ data, meta }` with `{ raw: true }`).
   */
  async request<T = any>(path: string, config: RequestConfig = {}, opts: { raw?: boolean } = {}): Promise<T> {
    const method = config.method || 'GET';
    const retrySafe = method === 'GET' || Boolean(config.idempotencyKey) || Boolean(config.retryUnsafe);
    let attempt = 0;

    for (;;) {
      try {
        return await this.fetchOnce<T>(path, method, config, opts.raw);
      } catch (error) {
        const err = toSdkError(error);
        if (config.signal?.aborted) throw err;
        const retryable = err.status === 0 || RETRYABLE_STATUS.has(err.status);
        if (!(retrySafe && retryable && attempt < this.maxRetries)) throw err;
        const retryAfter = err instanceof PartnerIQRateLimitError ? err.retryAfter : undefined;
        await sleep(retryAfter !== undefined ? Math.min(retryAfter * 1000, 30_000) : backoff(attempt));
        attempt++;
      }
    }
  }

  private async fetchOnce<T>(path: string, method: string, config: RequestConfig, raw?: boolean): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, positiveOr(config.timeout, this.timeout));
    const onAbort = () => controller.abort();
    config.signal?.addEventListener('abort', onAbort, { once: true });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${keys.get(this)}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      'PartnerIQ-Client': 'node',
      'PartnerIQ-Client-Version': VERSION,
    };
    if (config.body !== undefined) headers['Content-Type'] = 'application/json';
    if (config.idempotencyKey) headers['Idempotency-Key'] = config.idempotencyKey;

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}${buildQuery(config.query)}`, {
          method,
          headers,
          body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
          signal: controller.signal,
          redirect: 'error', // never replay the Authorization header to another host
        });
      } catch (error) {
        if (timedOut) {
          throw new PartnerIQConnectionError(`Request timed out after ${positiveOr(config.timeout, this.timeout)}ms`, { code: 'TIMEOUT' });
        }
        if (config.signal?.aborted) {
          throw new PartnerIQConnectionError('Request was aborted', { code: 'ABORTED' });
        }
        throw new PartnerIQConnectionError(
          `Could not reach PartnerIQ at ${this.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
          { code: 'NETWORK_ERROR' },
        );
      }

      const requestId = response.headers.get('x-request-id') || undefined;
      const payload = await parseBody(response);
      if (!response.ok || (isRecord(payload) && payload.success === false)) {
        throw toHttpError(response, payload, requestId);
      }
      if (!isRecord(payload) || !('data' in payload)) return payload as T;
      if (raw) {
        return (Array.isArray(payload.data) ? { data: payload.data, meta: payload.meta } : payload.data) as T;
      }
      return payload.data as T;
    } finally {
      clearTimeout(timer);
      config.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Never print the key: console.log(client) and JSON.stringify(client) show it redacted. */
  toJSON() {
    return { baseUrl: this.baseUrl, environment: this.environment, timeout: this.timeout, maxRetries: this.maxRetries };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `PartnerIQ { environment: '${this.environment}', baseUrl: '${this.baseUrl}' }`;
  }
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface VerifyWebhookSignatureInput {
  /** The exact bytes PartnerIQ sent, as a string or Buffer. Never a re-serialized JSON object. */
  rawBody: string | Uint8Array;
  /** The endpoint's signing secret. Pass an array during secret rotation. */
  secret: string | string[];
  /** `PartnerIQ-Signature` header (`v1=<hex>`; `t=…,v1=…` is also accepted). */
  signature: string;
  /** `PartnerIQ-Timestamp` header. */
  timestamp?: string | number;
  /** Maximum age in seconds (default 300). Rejects replays of old deliveries. */
  toleranceSeconds?: number;
}

/**
 * Returns true only when the body was signed by PartnerIQ with one of your
 * secrets within the tolerance window. Constant-time comparison throughout.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  try {
    verifyOrThrow(input);
    return true;
  } catch {
    return false;
  }
}

export interface ConstructEventInput {
  rawBody: string | Uint8Array;
  secret: string | string[];
  /**
   * Incoming request headers (Node/Express/Next `req.headers` or a Fetch
   * `Headers`). Alternatively pass `signature` and `timestamp` directly.
   */
  headers?: Headers | Record<string, string | string[] | undefined>;
  signature?: string;
  timestamp?: string | number;
  toleranceSeconds?: number;
}

/**
 * Verifies a webhook and returns the parsed event. Throws
 * PartnerIQSignatureVerificationError (respond 400) when it cannot be trusted.
 */
export function constructEvent<T = Record<string, unknown>>(input: ConstructEventInput): WebhookEvent<T> {
  const signature = input.signature ?? readHeader(input.headers, 'partneriq-signature');
  const timestamp = input.timestamp ?? readHeader(input.headers, 'partneriq-timestamp');
  verifyOrThrow({
    rawBody: input.rawBody,
    secret: input.secret,
    signature: signature || '',
    timestamp,
    toleranceSeconds: input.toleranceSeconds,
  });
  try {
    return JSON.parse(toUtf8(input.rawBody)) as WebhookEvent<T>;
  } catch {
    throw new PartnerIQSignatureVerificationError('Webhook body is not valid JSON', { code: 'INVALID_PAYLOAD' });
  }
}

function verifyOrThrow(input: VerifyWebhookSignatureInput): void {
  const fail = (message: string, code: string) => {
    throw new PartnerIQSignatureVerificationError(message, { code });
  };
  if (!input || typeof input !== 'object') fail('Missing verification input', 'INVALID_INPUT');
  const secrets = (Array.isArray(input.secret) ? input.secret : [input.secret]).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (!secrets.length) fail('A webhook signing secret is required', 'MISSING_SECRET');
  if (typeof input.signature !== 'string' || !input.signature.trim()) fail('Missing PartnerIQ-Signature header', 'MISSING_SIGNATURE');
  if (typeof input.rawBody !== 'string' && !(input.rawBody instanceof Uint8Array)) {
    fail('rawBody must be the raw request body (string or Buffer), not parsed JSON', 'INVALID_BODY');
  }

  let timestamp = input.timestamp !== undefined && input.timestamp !== '' ? Number(input.timestamp) : NaN;
  const candidates: string[] = [];
  for (const part of input.signature.split(',')) {
    const eq = part.indexOf('=');
    const k = eq === -1 ? '' : part.slice(0, eq).trim();
    const v = eq === -1 ? part.trim() : part.slice(eq + 1).trim();
    if (k === 't' && Number.isNaN(timestamp)) timestamp = Number(v);
    else if (k === 'v1' || k === '') candidates.push(v.toLowerCase());
  }

  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isFinite(timestamp)) fail('Missing PartnerIQ-Timestamp header', 'MISSING_TIMESTAMP');
  if (Math.abs(Date.now() / 1000 - timestamp) > tolerance) fail('Webhook timestamp is outside the tolerance window', 'TIMESTAMP_OUT_OF_TOLERANCE');

  const signed = `${timestamp}.${toUtf8(input.rawBody)}`;
  const ok = secrets.some((secret) => {
    const expected = Buffer.from(createHmac('sha256', secret).update(signed).digest('hex'));
    return candidates.some((candidate) => {
      const given = Buffer.from(candidate);
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
  });
  if (!ok) fail('Webhook signature does not match', 'SIGNATURE_MISMATCH');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PartnerIQError(`Invalid baseUrl: ${value}`, { code: 'INVALID_BASE_URL' });
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    // A secret key sent over plain http can be read by anyone on the path.
    throw new PartnerIQError('baseUrl must use https:// (http:// is allowed only for localhost)', { code: 'INSECURE_BASE_URL' });
  }
  if (url.username || url.password) {
    throw new PartnerIQError('baseUrl must not contain credentials', { code: 'INVALID_BASE_URL' });
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toHttpError(response: Response, payload: unknown, requestId?: string): PartnerIQError {
  const status = response.status;
  const body = isRecord(payload) ? payload : {};
  const error = isRecord(body.error) ? body.error : {};
  const rawMessage = error.message ?? body.message ?? (typeof body.error === 'string' ? body.error : undefined);
  const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : typeof rawMessage === 'string' ? rawMessage : '';
  const options = {
    code: typeof error.code === 'string' ? error.code : undefined,
    status,
    requestId: (typeof error.requestId === 'string' ? error.requestId : undefined) || requestId,
    details: error.details ?? body.details ?? (Array.isArray(rawMessage) ? rawMessage : undefined),
  };
  if (status === 400 || status === 422) return new PartnerIQValidationError(message || 'Validation failed', { ...options, code: options.code || 'VALIDATION_ERROR' });
  if (status === 401) return new PartnerIQAuthenticationError(message || 'Authentication failed', { ...options, code: options.code || 'UNAUTHORIZED' });
  if (status === 403) return new PartnerIQPermissionError(message || 'Permission denied', { ...options, code: options.code || 'FORBIDDEN' });
  if (status === 404) return new PartnerIQNotFoundError(message || 'Not found', { ...options, code: options.code || 'NOT_FOUND' });
  if (status === 409) return new PartnerIQConflictError(message || 'Conflict', { ...options, code: options.code || 'CONFLICT' });
  if (status === 429) {
    const err = new PartnerIQRateLimitError(message || 'Rate limit exceeded', { ...options, code: options.code || 'RATE_LIMITED' });
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter >= 0) err.retryAfter = retryAfter;
    return err;
  }
  return new PartnerIQApiError(message || `PartnerIQ request failed with HTTP ${status}`, { ...options, code: options.code || 'API_ERROR' });
}

function toSdkError(error: unknown): PartnerIQError {
  if (error instanceof PartnerIQError) return error;
  return new PartnerIQConnectionError(error instanceof Error ? error.message : 'Network request failed', { code: 'NETWORK_ERROR' });
}

function readHeader(headers: ConstructEventInput['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key ? record[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function toUtf8(body: string | Uint8Array): string {
  return typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PartnerIQValidationError(`${field} is required`, { code: 'INVALID_REQUEST', details: { field } });
  }
}

function requirePositiveInteger(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new PartnerIQValidationError(`${field} must be a positive integer in the smallest currency unit (e.g. paise)`, {
      code: 'INVALID_REQUEST',
      details: { field },
    });
  }
}

function pick<T extends object, K extends keyof T>(source: T, fields: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const field of fields) if (source[field] !== undefined) out[field] = source[field];
  return out;
}

function positiveOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter: ~0.5s, 1s, 2s… capped at 8s. */
function backoff(attempt: number) {
  const ceiling = Math.min(8000, 500 * 2 ** attempt);
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

export default PartnerIQ;
