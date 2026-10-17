import { encryptData, decryptData } from './crypto.js';
import { normalizeWorkspace } from './workspace.js';
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export function validateEncryptedPayload(payload) {
  if (
    typeof payload !== 'string' ||
    payload.length > MAX_BACKUP_BYTES ||
    !/^[0-9a-f]{32}:[0-9a-f]{24}:[0-9a-f]{32,}$/i.test(payload) ||
    payload.split(':')[2].length % 2
  )
    throw new Error('加密数据格式无效');
  return payload;
}
export function serializeBackup(payload) {
  return JSON.stringify({
    format: 'CardPulseVault',
    version: 1,
    payload: validateEncryptedPayload(payload),
  });
}
export function parseBackup(content) {
  if (
    typeof content !== 'string' ||
    new TextEncoder().encode(content).length > MAX_BACKUP_BYTES + 1024
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
  return validateEncryptedPayload(data.payload);
}
export async function encryptWorkspace(data, password) {
  return validateEncryptedPayload(
    await encryptData(normalizeWorkspace(data), password),
  );
}
export async function decryptWorkspace(payload, password) {
  return normalizeWorkspace(
    await decryptData(validateEncryptedPayload(payload), password),
  );
}
