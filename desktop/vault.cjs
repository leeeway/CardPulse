const fs = require('node:fs/promises');
const { COPYFILE_EXCL } = require('node:fs').constants;
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { maxPayloadBytes: MAX_VAULT_BYTES } = require('./vault-format.json');
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
function invalidVault(message) {
  const error = new Error(message);
  error.code = 'INVALID_VAULT_FILE';
  return error;
}
function parseVault(content) {
  if (
    typeof content !== 'string' ||
    Buffer.byteLength(content) > MAX_VAULT_BYTES + 1024
  )
    throw invalidVault('备份文件过大或格式无效');
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw invalidVault('备份文件格式无效');
  }
  if (data?.format !== 'CardPulseVault' || data.version !== 1)
    throw invalidVault('备份文件版本不受支持');
  try {
    return validatePayload(data.payload);
  } catch (error) {
    throw invalidVault(error.message);
  }
}
async function readVault(file) {
  try {
    if ((await fs.stat(file)).size > MAX_VAULT_BYTES + 1024)
      throw invalidVault('备份文件过大或格式无效');
    return parseVault(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function readLocalVault(file) {
  try {
    return await readVault(file);
  } catch (error) {
    // An unreadable format still represents an existing vault. Never treat it as
    // a new workspace or let an ordinary save overwrite it.
    if (error.code === 'INVALID_VAULT_FILE') return false;
    throw error;
  }
}
async function syncDirectory(directory) {
  // Windows does not expose a directory handle usable with fsync through Node.
  if (process.platform === 'win32') return;
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code))
      throw error;
  }
}
async function writeVault(file, payload) {
  const content = serializeVault(payload);
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Only publish a complete, flushed ciphertext.
    await fs.rename(temporary, file);
    // A failed directory flush cannot undo a completed rename.
    await syncDirectory(directory).catch((error) =>
      console.warn('CardPulse could not sync a vault directory:', error.code),
    );
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}
async function copyVaultBeforeRestore(file, destination) {
  // Preserve the exact bytes, including files from a newer version or a
  // damaged vault. Exclusive creation protects both the restore source and
  // other existing backups even if the dialog offered to replace them.
  try {
    await fs.copyFile(file, destination, COPYFILE_EXCL);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('请选择尚不存在的备份文件名');
    throw error;
  }
  try {
    await fs.chmod(destination, 0o600);
    const handle = await fs.open(destination, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(path.dirname(destination));
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}
function isVaultTemporaryName(file, name) {
  const prefix = `${path.basename(file)}.`;
  return (
    name.startsWith(prefix) &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.tmp$/.test(
      name.slice(prefix.length),
    )
  );
}
async function removeAbandonedVaultWrites(file) {
  const directory = path.dirname(file);
  const entries = await fs.readdir(directory).catch(() => []);
  for (const entry of entries)
    if (isVaultTemporaryName(file, entry))
      await fs.rm(path.join(directory, entry), { force: true }).catch(() => {});
}
module.exports = {
  MAX_VAULT_BYTES,
  validatePayload,
  serializeVault,
  parseVault,
  readVault,
  readLocalVault,
  writeVault,
  copyVaultBeforeRestore,
  isVaultTemporaryName,
  removeAbandonedVaultWrites,
};
