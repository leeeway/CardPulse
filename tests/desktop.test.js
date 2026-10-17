import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  encryptWorkspace,
  decryptWorkspace,
  serializeBackup,
  parseBackup,
} from '../src/core/backup.js';
import { emptyWorkspace } from '../src/core/workspace.js';
const require = createRequire(import.meta.url);
const {
  resolveAsset,
  isAppUrl,
  isExternalUrl,
  CSP,
} = require('../desktop/security.cjs');
const {
  readVault,
  writeVault,
  parseVault,
  validatePayload,
} = require('../desktop/vault.cjs');

it('桌面协议拒绝跨目录资源、非应用主机及不可信外链', () => {
  const root = join(tmpdir(), 'dist');
  assert.equal(
    resolveAsset('cardpulse://app/', root),
    join(root, 'index.html'),
  );
  assert.equal(
    resolveAsset('cardpulse://app/assets/app.js', root),
    join(root, 'assets/app.js'),
  );
  for (const url of [
    'cardpulse://evil/',
    'cardpulse://app/%2e%2e%2fsecret',
    'cardpulse://app/%00',
    'cardpulse://app/foo%5csecret',
    'https://evil.test/',
  ])
    assert.equal(resolveAsset(url, root), null);
  assert.equal(isAppUrl('cardpulse://app.evil/'), false);
  assert.equal(
    isExternalUrl('https://github.com/leeeway/CardPulse/releases'),
    true,
  );
  for (const url of [
    'file:///etc/passwd',
    'https://evil.test/',
    'https://github.com/attacker/repo',
    'https://user:pass@www.sc.com/',
    'javascript:alert(1)',
  ])
    assert.equal(isExternalUrl(url), false);
  assert.ok(CSP.includes("connect-src 'self' blob:"));
  assert.ok(!CSP.includes('unsafe-eval'));
});
it('网页和桌面使用相同加密备份格式，错误密码和篡改数据不能恢复', async () => {
  const data = {
    ...emptyWorkspace(),
    exchangeRate: { rate: 0.93, date: '2026-10-17', source: 'manual' },
  };
  const payload = await encryptWorkspace(data, 'backup password');
  assert.equal(parseBackup(serializeBackup(payload)), payload);
  assert.equal(parseVault(serializeBackup(payload)), payload);
  assert.deepEqual(await decryptWorkspace(payload, 'backup password'), data);
  await assert.rejects(decryptWorkspace(payload, 'wrong password'));
  const tampered =
    payload.slice(0, -2) + (payload.endsWith('00') ? '01' : '00');
  await assert.rejects(decryptWorkspace(tampered, 'backup password'));
  for (const bad of [
    'plaintext',
    JSON.stringify(data),
    '0'.repeat(32) + ':' + '0'.repeat(24) + ':abc',
  ])
    assert.throws(() => validatePayload(bad));
  assert.throws(() => parseBackup('{"format":"CardPulseVault","version":99}'));
});
it('本地文件仅保留密文，原子覆盖、读取和缺失数据行为正确', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cardpulse-vault-'));
  try {
    const file = join(directory, 'vault.cardpulse');
    assert.equal(await readVault(file), null);
    const payload = await encryptWorkspace(emptyWorkspace(), 'local password');
    await writeVault(file, payload);
    assert.equal(await readVault(file), payload);
    const raw = await readFile(file, 'utf8');
    assert.equal(raw.includes('transactions'), false);
    assert.equal(raw.includes('local password'), false);
    await assert.rejects(writeVault(file, 'plaintext'));
    assert.equal(await readVault(file), payload);
    assert.deepEqual(await readdir(directory), ['vault.cardpulse']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
