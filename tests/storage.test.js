import 'fake-indexeddb/auto';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { IDBObjectStore } from 'fake-indexeddb';
import {
  hasEncryptedVault,
  saveToVault,
  loadFromVault,
  clearVault,
} from '../src/core/storage.js';

it('保险库支持加密保存、更新、密码验证与清空', async () => {
  await clearVault();
  assert.equal(await hasEncryptedVault(), false);
  const data = {
    transactions: [{ amount: '50.00' }],
    statements: [{ id: 'hash' }],
  };
  await saveToVault(data, 'password');
  assert.equal(await hasEncryptedVault(), true);
  assert.deepEqual(await loadFromVault('password'), data);
  await assert.rejects(loadFromVault('wrong'), /密码/);
  await saveToVault({ transactions: [] }, 'password');
  assert.deepEqual(await loadFromVault('password'), { transactions: [] });
  await clearVault();
  assert.equal(await loadFromVault('password'), null);
});

it('请求成功后事务中止仍然报告失败，并保留之前的密文', async () => {
  await saveToVault({ version: 1 }, 'password');
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(saveToVault({ version: 2 }, 'password'), /中止/);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await loadFromVault('password'), { version: 1 });
  await clearVault();
});

it('新版保险库保存活动配置，读取时能兼容旧版交易库', async () => {
  const { normalizeWorkspace, emptyWorkspace } =
    await import('../src/core/workspace.js');
  const campaign = {
    id: 'activity',
    name: 'Saved campaign',
    bankId: 'bochk',
    currency: 'HKD',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ratePercent: '2.5',
    period: 'monthly',
    dateBasis: 'posting',
    channel: 'any',
    registrationConfirmed: true,
  };
  const workspace = { ...emptyWorkspace(), campaigns: [campaign] };
  await saveToVault(workspace, 'password');
  assert.equal(
    normalizeWorkspace(await loadFromVault('password')).campaigns[0].name,
    campaign.name,
  );
  await saveToVault({ transactions: [] }, 'password');
  assert.deepEqual(
    normalizeWorkspace(await loadFromVault('password')),
    emptyWorkspace(),
  );
  await clearVault();
});

it('两个页面同时保存时只有一个成功，冲突页面不能清空或重新验证密码后覆盖新数据', async () => {
  const { createVaultClient } = await import('../src/core/storage.js');
  const a = createVaultClient();
  const b = createVaultClient();
  assert.equal(await a.hasEncryptedVault(), false);
  assert.equal(await b.hasEncryptedVault(), false);
  const results = await Promise.allSettled([
    a.saveToVault({ source: 'A' }, 'password'),
    b.saveToVault({ source: 'B' }, 'password'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const loser = results[0].status === 'rejected' ? a : b;
  const winner = loser === a ? b : a;
  const isConflict = (error) => error.code === 'VAULT_CONFLICT';
  assert.ok(isConflict(results.find((r) => r.status === 'rejected').reason));
  const saved = await winner.loadFromVault('password');
  await assert.rejects(loser.loadFromVault('password'), isConflict);
  await assert.rejects(loser.clearVault(), isConflict);
  // Password-only verification for exporting unsaved work never rebases a page.
  assert.deepEqual(
    await loser.loadFromVault('password', { checkSnapshot: false }),
    saved,
  );
  await assert.rejects(
    loser.saveToVault({ source: 'stale' }, 'password'),
    isConflict,
  );
  assert.deepEqual(await winner.loadFromVault('password'), saved);
  assert.deepEqual(
    await loser.loadFromVault('password', { refresh: true }),
    saved,
  );
  await loser.saveToVault({ source: 'after reload' }, 'password');
  await assert.rejects(winner.clearVault(), isConflict);
  await loser.clearVault();
});

it('其他页面删除保险库后，旧页面不能把已经删除的数据写回', async () => {
  const { createVaultClient } = await import('../src/core/storage.js');
  const a = createVaultClient();
  await a.saveToVault({ source: 'original' }, 'password');
  const b = createVaultClient();
  await b.loadFromVault('password', { refresh: true });
  await a.clearVault();
  await assert.rejects(b.saveToVault({ source: 'deleted' }, 'password'), {
    code: 'VAULT_CONFLICT',
  });
  await assert.rejects(b.clearVault(), { code: 'VAULT_CONFLICT' });
  assert.equal(await a.loadFromVault('password'), null);
});
