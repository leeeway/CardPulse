/** Encrypted workspace storage. Writes succeed only after the transaction commits. */
import { encryptData, decryptData } from './crypto.js';

const STORE_NAME = 'vault';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CardPulse_DB', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new Error('本地库被其他页面占用，请关闭其他 CardPulse 页面后重试'),
      );
  });
}

async function accessVault(mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = operation(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('本地存储事务已中止'));
      tx.onerror = () => reject(tx.error || new Error('本地存储失败'));
    });
  } finally {
    db.close();
  }
}

export async function hasEncryptedVault() {
  if (globalThis.cardpulseDesktop)
    return Boolean(await globalThis.cardpulseDesktop.readVault());
  // A storage failure must never be interpreted as an empty vault.
  return Boolean(
    await accessVault('readonly', (store) => store.get('vault_payload')),
  );
}

export async function saveToVault(data, password) {
  const payload = await encryptData(data, password);
  if (globalThis.cardpulseDesktop)
    return globalThis.cardpulseDesktop.writeVault(payload);
  await accessVault('readwrite', (store) =>
    store.put({ id: 'vault_payload', payload, updatedAt: Date.now() }),
  );
}

export async function loadFromVault(password) {
  const desktop = globalThis.cardpulseDesktop;
  const record = desktop
    ? { payload: await desktop.readVault() }
    : await accessVault('readonly', (store) => store.get('vault_payload'));
  if (!record?.payload) return null;
  try {
    return await decryptData(record.payload, password);
  } catch {
    throw new Error('密码不正确或数据已损坏');
  }
}

export async function clearVault() {
  if (globalThis.cardpulseDesktop)
    return globalThis.cardpulseDesktop.clearVault();
  await accessVault('readwrite', (store) => store.clear());
}
