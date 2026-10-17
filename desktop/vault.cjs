const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_VAULT_BYTES = 50 * 1024 * 1024;
function validatePayload(payload) {
  if (
    typeof payload !== 'string' ||
    payload.length > MAX_VAULT_BYTES ||
    !/^[0-9a-f]{32}:[0-9a-f]{24}:[0-9a-f]{32,}$/i.test(payload) ||
    payload.split(':')[2].length % 2
  )
    throw new Error('加密数据格式无效');
  return payload;
}
function serializeVault(payload) {
  return JSON.stringify({
    format: 'CardPulseVault',
    version: 1,
    payload: validatePayload(payload),
  });
}
function parseVault(content) {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content) > MAX_VAULT_BYTES + 1024
  )
    throw new Error('备份文件过大或格式无效');
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('备份文件格式无效');
  }
  if (data?.format !== 'CardPulseVault' || data.version !== 1)
    throw new Error('备份文件版本不受支持');
  return validatePayload(data.payload);
}
async function readVault(file) {
  try {
    if ((await fs.stat(file)).size > MAX_VAULT_BYTES + 1024)
      throw new Error('备份文件过大或格式无效');
    return parseVault(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function writeVault(file, payload) {
  const content = serializeVault(payload);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    // Same-directory rename publishes a complete ciphertext, never a half-written vault.
    await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
module.exports = {
  MAX_VAULT_BYTES,
  validatePayload,
  serializeVault,
  parseVault,
  readVault,
  writeVault,
};
