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

export const VAULT_CONFLICT_MESSAGE =
  '本地库已被其他页面修改，操作已停止。当前修改仍保留，请先导出加密备份，再刷新并解锁最新数据。';

function conflictError() {
  const error = new Error(VAULT_CONFLICT_MESSAGE);
  error.code = 'VAULT_CONFLICT';
  return error;
}

async function readPayload() {
  if (globalThis.cardpulseDesktop)
    return (await globalThis.cardpulseDesktop.readVault()) || null;
  const record = await accessVault('readonly', (store) =>
    store.get('vault_payload'),
  );
  return record?.payload || null;
}

// Compare and mutate inside one readwrite transaction. A separate read followed by
// a write would still allow two tabs to pass the comparison simultaneously.
async function writeBrowserPayload(expected, payload) {
  let conflict = false;
  try {
    await accessVault('readwrite', (store) => {
      const request = store.get('vault_payload');
      request.onsuccess = () => {
        if ((request.result?.payload || null) !== expected) {
          conflict = true;
          store.transaction.abort();
          return;
        }
        if (payload === null) store.delete('vault_payload');
        else store.put({ id: 'vault_payload', payload, updatedAt: Date.now() });
      };
      return request;
    });
  } catch (error) {
    if (conflict) throw conflictError();
    throw error;
  }
}

// Each open workspace keeps its own baseline. Password verification and backup
// export must not silently accept another tab's data as the current workspace.
export function createVaultClient() {
  let baseline;
  const initialize = async () => {
    if (baseline === undefined) baseline = await readPayload();
    return baseline;
  };
  const assertCurrent = (payload) => {
    if (baseline !== undefined && payload !== baseline) throw conflictError();
  };
  const write = async (expected, payload) => {
    if (globalThis.cardpulseDesktop) {
      // Desktop already permits only one app instance per profile.
      if ((await readPayload()) !== expected) throw conflictError();
      if (payload === null) await globalThis.cardpulseDesktop.clearVault();
      else await globalThis.cardpulseDesktop.writeVault(payload);
    } else await writeBrowserPayload(expected, payload);
    baseline = payload;
  };
  return {
    async hasEncryptedVault() {
      const payload = await readPayload();
      if (baseline === undefined) baseline = payload;
      return Boolean(payload);
    },
    async saveToVault(data, password) {
      const expected = await initialize();
      const payload = await encryptData(data, password);
      await write(expected, payload);
    },
    async loadFromVault(
      password,
      { refresh = false, checkSnapshot = true } = {},
    ) {
      const payload = await readPayload();
      if (!refresh && checkSnapshot) assertCurrent(payload);
      if (!payload) {
        if (refresh || baseline === undefined) baseline = null;
        return null;
      }
      let data;
      try {
        data = await decryptData(payload, password);
      } catch {
        throw new Error('密码不正确或数据已损坏');
      }
      if (refresh || baseline === undefined) baseline = payload;
      return data;
    },
    async clearVault() {
      const expected = await initialize();
      await write(expected, null);
    },
  };
}

// Retain the module API for storage consumers; the UI creates one client per app.
export const { hasEncryptedVault, saveToVault, loadFromVault, clearVault } =
  createVaultClient();
