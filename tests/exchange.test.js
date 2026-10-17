import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHkdCnyRate } from '../src/core/exchange.js';

it('获取汇率时不传递凭证，失败或无效汇率不提供猜测值', async t => {
  let response = { rate: 0.92, date: '2026-01-02' };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return { ok: true, json: async () => response };
  });
  assert.equal((await fetchHkdCnyRate()).rate, 0.92);
  response = { rate: -1 };
  assert.equal((await fetchHkdCnyRate()).rate, null);
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error('offline'); });
  assert.equal((await fetchHkdCnyRate()).rate, null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchHkdCnyRate({ signal: controller.signal }));
});
