import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import {
  PartnerIQ,
  PartnerIQAuthenticationError,
  PartnerIQConflictError,
  PartnerIQConnectionError,
  PartnerIQNotFoundError,
  PartnerIQPermissionError,
  PartnerIQRateLimitError,
  PartnerIQSignatureVerificationError,
  PartnerIQValidationError,
  constructEvent,
  verifyWebhookSignature,
} from '../dist/index.mjs';

const KEY = 'pi_test_sk_' + 'a'.repeat(43);

/** Records calls and replies with the queued responses in order. */
function mockFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    const { status = 200, body = { success: true, data: {} }, headers = {} } = reply;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  };
  fn.calls = calls;
  return fn;
}

function client(fetch, extra = {}) {
  return new PartnerIQ({ apiKey: KEY, baseUrl: 'https://api.example.test', fetch, maxRetries: 2, ...extra });
}

test('rejects missing, malformed and public keys', () => {
  assert.throws(() => new PartnerIQ({ apiKey: '' }), PartnerIQAuthenticationError);
  assert.throws(() => new PartnerIQ({ apiKey: 'sk_live_123' }), /pi_test_sk_ or pi_live_sk_/);
  assert.throws(() => new PartnerIQ({ apiKey: 'pi_live_pk_' + 'a'.repeat(43) }), /public browser key/);
});

test('refuses plain http except for localhost', () => {
  assert.throws(() => new PartnerIQ({ apiKey: KEY, baseUrl: 'http://api.partneriq.in' }), /https/);
  assert.doesNotThrow(() => new PartnerIQ({ apiKey: KEY, baseUrl: 'http://localhost:5000' }));
});

test('defaults to the production API and derives the environment', () => {
  const c = new PartnerIQ({ apiKey: KEY, fetch: mockFetch({}) });
  assert.equal(c.baseUrl, 'https://api.partneriq.in');
  assert.equal(c.environment, 'test');
});

test('never exposes the key through inspect or JSON', () => {
  const c = client(mockFetch({}));
  assert.ok(!inspect(c).includes(KEY));
  assert.ok(!JSON.stringify(c).includes(KEY));
});

test('conversions.create sends auth, derived idempotency key and unwraps data', async () => {
  const fetch = mockFetch({ status: 201, body: { success: true, data: { conversion: { id: 'cv_1' } } } });
  const result = await client(fetch).conversions.create({
    externalId: 'order_1',
    customerExternalId: 'cus_1',
    amount: 49900,
    currency: 'INR',
  });
  assert.equal(result.conversion.id, 'cv_1');
  const [call] = fetch.calls;
  assert.equal(call.url, 'https://api.example.test/api/v1/conversions');
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.headers['Idempotency-Key'], 'conversion:order_1');
  assert.equal(call.init.redirect, 'error');
});

test('conversions.create validates the amount before sending', async () => {
  const fetch = mockFetch({});
  await assert.rejects(
    client(fetch).conversions.create({ externalId: 'o', customerExternalId: 'c', amount: 499.5 }),
    PartnerIQValidationError,
  );
  assert.equal(fetch.calls.length, 0);
});

test('retries idempotent writes on 503 and succeeds', async () => {
  const fetch = mockFetch(
    { status: 503, body: { success: false, error: { message: 'busy' } } },
    { status: 201, body: { success: true, data: { conversion: { id: 'cv_2' } } } },
  );
  const result = await client(fetch).conversions.create({ externalId: 'o2', customerExternalId: 'c', amount: 100 });
  assert.equal(result.conversion.id, 'cv_2');
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].headers['Idempotency-Key'], 'conversion:o2');
});

test('does not retry a refund that has no idempotency key', async () => {
  const fetch = mockFetch({ status: 503, body: { success: false } });
  await assert.rejects(client(fetch).conversions.refund('order_1', { amount: 100 }));
  assert.equal(fetch.calls.length, 1);
});

test('refund supports the 1.0 call shape', async () => {
  const fetch = mockFetch({ body: { success: true, data: { refunded: true } } });
  await client(fetch).conversions.refund({ externalId: 'order 1', refundExternalId: 'rf_1', amount: 100 });
  const [call] = fetch.calls;
  assert.equal(call.url, 'https://api.example.test/api/v1/conversions/order%201/refund');
  assert.deepEqual(call.body, { refundExternalId: 'rf_1', amount: 100 });
  assert.equal(call.headers['Idempotency-Key'], 'refund:rf_1');
});

test('honours Retry-After on 429', async () => {
  const fetch = mockFetch(
    { status: 429, body: { success: false, error: { message: 'slow down' } }, headers: { 'retry-after': '0' } },
    { body: { success: true, data: [] } },
  );
  await client(fetch).webhooks.endpoints.list();
  assert.equal(fetch.calls.length, 2);
});

test('maps HTTP errors to typed errors with request ids', async () => {
  const cases = [
    [401, PartnerIQAuthenticationError],
    [403, PartnerIQPermissionError],
    [404, PartnerIQNotFoundError],
    [409, PartnerIQConflictError],
    [422, PartnerIQValidationError],
  ];
  for (const [status, Type] of cases) {
    const fetch = mockFetch({
      status,
      body: { success: false, error: { code: 'X', message: 'nope', requestId: 'req_1' } },
    });
    const err = await client(fetch, { maxRetries: 0 }).affiliates.get('aff_1').catch((e) => e);
    assert.ok(err instanceof Type, `${status} -> ${Type.name}`);
    assert.equal(err.requestId, 'req_1');
    assert.equal(err.status, status);
  }
  const rate = await client(mockFetch({ status: 429, body: {} }), { maxRetries: 0 }).programs.list().catch((e) => e);
  assert.ok(rate instanceof PartnerIQRateLimitError);
});

test('joins class-validator message arrays', async () => {
  const fetch = mockFetch({ status: 400, body: { success: false, message: ['amount must be a number', 'externalId must be a string'] } });
  const err = await client(fetch).affiliates.get('a').catch((e) => e);
  assert.match(err.message, /amount must be a number; externalId must be a string/);
});

test('times out and surfaces a connection error', async () => {
  const slow = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const err = await client(slow, { timeout: 20, maxRetries: 0 }).programs.list().catch((e) => e);
  assert.ok(err instanceof PartnerIQConnectionError);
  assert.equal(err.code, 'TIMEOUT');
});

test('trackingLinks use the API-key routes and return pages', async () => {
  const fetch = mockFetch(
    { body: { success: true, data: { id: 'tl_1' } } },
    { body: { success: true, data: [{ id: 'tl_1' }], meta: { page: 1 } } },
  );
  const c = client(fetch);
  await c.trackingLinks.create({ organizationId: 'ignored', programId: 'p', affiliateId: 'a', destinationUrl: 'https://x.test' });
  const page = await c.trackingLinks.list('legacy-org-id', { programId: 'p', limit: 5 });
  assert.equal(fetch.calls[0].url, 'https://api.example.test/api/v1/tracking-links');
  assert.equal(fetch.calls[0].body.organizationId, undefined);
  assert.equal(fetch.calls[1].url, 'https://api.example.test/api/v1/tracking-links?programId=p&limit=5');
  assert.deepEqual(page, { data: [{ id: 'tl_1' }], meta: { page: 1 } });
});

test('customers.identify uses the secret-key route and requires one selector', async () => {
  const fetch = mockFetch({ body: { success: true, data: { updatedAttributions: 1 } } });
  const c = client(fetch);
  await c.customers.identify({ customerId: 'cus_1', anonymousId: 'anon_1', publicKey: 'pi_live_pk_x' });
  assert.equal(fetch.calls[0].url, 'https://api.example.test/api/v1/customers/identify');
  assert.deepEqual(fetch.calls[0].body, { customerId: 'cus_1', anonymousId: 'anon_1' });
  await assert.rejects(c.customers.identify({ customerId: 'cus_1' }), PartnerIQValidationError);
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const SECRET = 'whsec_test_secret';
function sign(body, ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  return { ts, sig: `v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}` };
}

test('verifies a valid signature and rejects tampering, replays and wrong secrets', () => {
  const body = JSON.stringify({ id: 'evt_1', event: 'conversion.created', data: {} });
  const { ts, sig } = sign(body);
  assert.equal(verifyWebhookSignature({ rawBody: body, secret: SECRET, signature: sig, timestamp: ts }), true);
  assert.equal(verifyWebhookSignature({ rawBody: Buffer.from(body), secret: SECRET, signature: sig, timestamp: ts }), true);
  assert.equal(verifyWebhookSignature({ rawBody: body + ' ', secret: SECRET, signature: sig, timestamp: ts }), false);
  assert.equal(verifyWebhookSignature({ rawBody: body, secret: 'other', signature: sig, timestamp: ts }), false);
  const old = sign(body, ts - 600);
  assert.equal(verifyWebhookSignature({ rawBody: body, secret: SECRET, signature: old.sig, timestamp: old.ts }), false);
  assert.equal(verifyWebhookSignature({ rawBody: JSON.parse(body), secret: SECRET, signature: sig, timestamp: ts }), false);
});

test('accepts any of several secrets during rotation and the t=,v1= header form', () => {
  const body = '{"id":"evt_2"}';
  const { ts, sig } = sign(body);
  assert.equal(verifyWebhookSignature({ rawBody: body, secret: ['old', SECRET], signature: sig, timestamp: ts }), true);
  assert.equal(verifyWebhookSignature({ rawBody: body, secret: SECRET, signature: `t=${ts},${sig}` }), true);
});

test('constructEvent reads headers and returns the parsed event', () => {
  const body = JSON.stringify({ id: 'evt_3', event: 'payout.completed', environment: 'live', timestamp: 1, data: { id: 'po_1' } });
  const { ts, sig } = sign(body);
  const event = constructEvent({
    rawBody: body,
    secret: SECRET,
    headers: { 'PartnerIQ-Signature': sig, 'partneriq-timestamp': String(ts) },
  });
  assert.equal(event.id, 'evt_3');
  assert.equal(event.data.id, 'po_1');
  assert.throws(
    () => constructEvent({ rawBody: body, secret: SECRET, headers: new Headers({ 'PartnerIQ-Signature': 'v1=00', 'PartnerIQ-Timestamp': String(ts) }) }),
    PartnerIQSignatureVerificationError,
  );
});

test('validation failures are rejected promises, not synchronous throws', () => {
  const c = client(mockFetch({}));
  const pending = c.conversions.create({ externalId: '', customerExternalId: 'c', amount: 1 });
  assert.ok(pending instanceof Promise);
  return assert.rejects(pending, PartnerIQValidationError);
});
