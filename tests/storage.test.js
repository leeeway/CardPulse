import 'fake-indexeddb/auto';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { IDBObjectStore } from 'fake-indexeddb';
import { hasEncryptedVault, saveToVault, loadFromVault, clearVault } from '../src/core/storage.js';

it('保险库支持加密保存、更新、密码验证与清空', async () => {
  await clearVault();
  assert.equal(await hasEncryptedVault(), false);
  const data = { transactions: [{ amount: '50.00' }], statements: [{ id: 'hash' }] };
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
