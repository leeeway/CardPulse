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

it('修改密码只重新加密已保存数据，旧备份继续使用原密码', async () => {
  const { createVaultClient } = await import('../src/core/storage.js');
  const { encryptWorkspace, decryptWorkspace } =
    await import('../src/core/backup.js');
  const { emptyWorkspace } = await import('../src/core/workspace.js');
  const saved = {
    ...emptyWorkspace(),
    exchangeRate: { rate: 0.93, date: '2026-11-05', source: 'manual' },
  };
  const client = createVaultClient();
  await client.saveToVault(saved, 'old password');
  const oldBackup = await encryptWorkspace(saved, 'old password');
  for (const [current, next, message] of [
    ['', 'next', /当前密码/],
    ['old password', '', /新密码/],
    ['old password', 'old password', /相同/],
    ['wrong', 'next', /密码不正确/],
  ])
    await assert.rejects(client.changePassword(current, next), message);
  assert.deepEqual(await client.loadFromVault('old password'), saved);
  await client.changePassword('old password', 'new password');
  await assert.rejects(client.loadFromVault('old password'), /密码不正确/);
  assert.deepEqual(await client.loadFromVault('new password'), saved);
  assert.deepEqual(await decryptWorkspace(oldBackup, 'old password'), saved);
  await assert.rejects(decryptWorkspace(oldBackup, 'new password'));
  await client.saveToVault({ ...saved, campaigns: [] }, 'new password');
  await client.clearVault();
  await assert.rejects(client.changePassword('new password', 'next'), /不存在/);
});

it('改密写入失败时原密码仍可使用，重试成功后才更新基线', async () => {
  const { createVaultClient } = await import('../src/core/storage.js');
  const client = createVaultClient();
  await client.saveToVault({ saved: 'original' }, 'old');
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(client.changePassword('old', 'new'), /中止/);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await client.loadFromVault('old'), { saved: 'original' });
  await assert.rejects(client.loadFromVault('new'), /密码不正确/);
  await client.changePassword('old', 'new');
  assert.deepEqual(await client.loadFromVault('new'), { saved: 'original' });
  await client.clearVault();
});

it('密钥派生期间其他页面保存时，改密不能覆盖新数据，重新输入旧密码也不能绕过冲突', async () => {
  const { createVaultClient } = await import('../src/core/storage.js');
  const a = createVaultClient();
  const b = createVaultClient();
  await a.saveToVault({ revision: 1 }, 'old');
  await b.loadFromVault('old', { refresh: true });
  const originalEncrypt = crypto.subtle.encrypt;
  crypto.subtle.encrypt = async function (...args) {
    crypto.subtle.encrypt = originalEncrypt;
    const encrypted = await originalEncrypt.apply(this, args);
    await b.saveToVault({ revision: 2 }, 'old');
    return encrypted;
  };
  try {
    await assert.rejects(a.changePassword('old', 'new'), {
      code: 'VAULT_CONFLICT',
    });
  } finally {
    crypto.subtle.encrypt = originalEncrypt;
  }
  await assert.rejects(a.changePassword('old', 'new'), {
    code: 'VAULT_CONFLICT',
  });
  assert.deepEqual(await b.loadFromVault('old'), { revision: 2 });
  await assert.rejects(b.loadFromVault('new'), /密码不正确/);
  await b.clearVault();
});
