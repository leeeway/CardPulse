import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertVaultCapacity,
  encryptData,
  decryptData,
  MAX_VAULT_PAYLOAD_BYTES,
} from '../src/core/crypto.js';

describe('端侧 Web Crypto 加解密模块', () => {
  it('正确加密与解密字符串', async () => {
    const secret = 'MySensitiveCardData-8812';
    const password = 'StrongMasterPassword!123';

    const encrypted = await encryptData(secret, password);
    assert.notEqual(encrypted, secret);
    assert.equal(encrypted.split(':').length, 3); // salt:iv:ciphertext

    const decrypted = await decryptData(encrypted, password);
    assert.equal(decrypted, secret);
  });

  it('正确加密与解密对象', async () => {
    const data = {
      card: 'HSBC Pulse',
      transactions: [{ id: 1, amount: '100.00' }]
    };
    const password = 'KeyPass';

    const encrypted = await encryptData(data, password);
    const decrypted = await decryptData(encrypted, password);
    assert.deepEqual(decrypted, data);
  });

  it('错误密码解密抛出异常', async () => {
    const secret = 'Confidential';
    const encrypted = await encryptData(secret, 'RightPassword');

    await assert.rejects(async () => {
      await decryptData(encrypted, 'WrongPassword');
    });
  });

  it('按 UTF-8 字节及加密封装计算容量，超限时在加密前拒绝', async () => {
    const plaintextLimit = (MAX_VAULT_PAYLOAD_BYTES - 2) / 2 - 16 - 12 - 16;
    const atLimit =
      '账'.repeat(Math.floor(plaintextLimit / 3)) +
      'a'.repeat(plaintextLimit % 3);
    assert.doesNotThrow(() => assertVaultCapacity(atLimit));
    await assert.rejects(encryptData(atLimit + 'a', 'fixture'), /加密容量上限/);
  });
});
