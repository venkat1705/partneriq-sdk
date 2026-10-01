import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Minimal DOM: location/history, a cookie jar, Web Storage. Enough to exercise
 * the SDK's real code paths without a browser.
 */
function installDom(href) {
  const jar = new Map();
  const storage = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  };
  const location = new URL(href);
  globalThis.window = {
    get location() {
      return { href: location.href, protocol: location.protocol };
    },
    history: {
      state: null,
      replaceState: (_s, _t, next) => {
        location.href = next;
      },
    },
    localStorage: storage(),
    sessionStorage: storage(),
  };
  globalThis.document = {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(raw) {
      const [pair, ...attrs] = raw.split('; ');
      const [k, v] = pair.split('=');
      if (attrs.some((a) => a === 'Max-Age=0')) jar.delete(k);
      else jar.set(k, v);
    },
  };
  return { location };
}

const calls = [];
function mockFetch(reply) {
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const { status = 200, body } = typeof reply === 'function' ? reply() : reply;
    return new Response(JSON.stringify(body), { status });
  };
}

const { PartnerIQ, PartnerIQBrowserError } = await import('../dist/index.mjs');
const KEY = 'pi_live_pk_abc_sk_def123';

beforeEach(() => {
  calls.length = 0;
});

test('refuses secret keys and malformed keys', () => {
  assert.throws(() => PartnerIQ.init({ publicKey: 'pi_live_sk_abcdef' }), /must never be used in the browser/);
  assert.throws(() => PartnerIQ.init({ publicKey: 'sk_live_abcdef' }), PartnerIQBrowserError);
  assert.throws(() => PartnerIQ.init({ publicKey: 'hello' }), /pi_test_pk_ or pi_live_pk_/);
  // A public key whose random part contains "_sk_" is still a public key.
  assert.doesNotThrow(() => PartnerIQ.init({ publicKey: KEY }));
});

test('captures pi_click_id / pi_anon_id from a /r/ redirect and cleans the URL', async () => {
  const { location } = installDom(
    'https://shop.test/pricing?plan=pro&pi_click_id=11111111-2222-3333-4444-555555555555&pi_anon_id=anon_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  );
  mockFetch({ body: {} });
  PartnerIQ.init({ publicKey: KEY });
  const attribution = await PartnerIQ.captureReferral();
  assert.equal(attribution.clickId, '11111111-2222-3333-4444-555555555555');
  assert.equal(attribution.anonymousId, 'anon_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(calls.length, 0, 'redirect clicks are already recorded server-side');
  assert.equal(location.href, 'https://shop.test/pricing?plan=pro');
});

test('ignores malformed ids injected through the URL', async () => {
  installDom('https://shop.test/?pi_click_id=%3Cscript%3E&pi_anon_id=x');
  mockFetch({ body: {} });
  PartnerIQ.init({ publicKey: KEY });
  const attribution = await PartnerIQ.captureReferral();
  assert.deepEqual(attribution, { anonymousId: null, clickId: null });
});

test('records a ?ref= click once per landing URL and reuses the visitor id', async () => {
  installDom('https://shop.test/?ref=sarah');
  mockFetch({
    body: {
      success: true,
      data: { tracked: true, anonymousId: 'anon_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', clickId: 'click_0001', cookieMaxAgeMs: 86_400_000 },
    },
  });
  PartnerIQ.init({ publicKey: KEY, apiUrl: 'https://api.test/' });
  const first = await PartnerIQ.captureReferral();
  await PartnerIQ.captureReferral();
  assert.equal(calls.length, 1, 'a reload of the same landing URL is not a second click');
  assert.equal(calls[0].url, 'https://api.test/api/v1/tracking/click');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].body.shortCode, 'sarah');
  assert.equal(first.clickId, 'click_0001');
});

test('a tracking failure never throws from captureReferral', async () => {
  installDom('https://shop.test/?ref=bob');
  mockFetch({ status: 403, body: { success: false, error: { message: 'origin not allowed' } } });
  PartnerIQ.init({ publicKey: KEY });
  const original = console.warn;
  console.warn = () => {};
  try {
    const attribution = await PartnerIQ.captureReferral();
    assert.deepEqual(attribution, { anonymousId: null, clickId: null });
  } finally {
    console.warn = original;
  }
});

test('identify links the stored visitor and is a no-op without one', async () => {
  installDom('https://shop.test/');
  mockFetch({ body: { success: true, data: { success: true, updatedAttributions: 1 } } });
  PartnerIQ.init({ publicKey: KEY });
  assert.equal(await PartnerIQ.identify({ customerId: 'cus_1' }), null);
  assert.equal(calls.length, 0);

  window.localStorage.setItem('pi_anon_id', 'anon_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  await PartnerIQ.identify({ customerId: 'cus_1' });
  assert.deepEqual(calls[0].body, {
    publicKey: KEY,
    anonymousId: 'anon_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    customerExternalId: 'cus_1',
  });
  await assert.rejects(PartnerIQ.identify({ customerId: '' }), /customerId/);
});

test('survives storage that throws (private mode)', async () => {
  installDom('https://shop.test/');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  window.localStorage = broken;
  window.sessionStorage = broken;
  PartnerIQ.init({ publicKey: KEY });
  assert.deepEqual(PartnerIQ.getAttribution(), { anonymousId: null, clickId: null });
  assert.doesNotThrow(() => PartnerIQ.clearAttribution());
});
