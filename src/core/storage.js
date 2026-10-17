/**
 * IndexedDB 本地加密持久化模块
 * 结合 Web Crypto 对结单与交易明细进行端侧透明加解密
 */

import { encryptData, decryptData } from './crypto.js';

const DB_NAME = 'CardPulse_DB';
const DB_VERSION = 1;
const STORE_NAME = 'vault';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 检查本地存储是否存在已加密的保险库
 */
export async function hasEncryptedVault() {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get('vault_payload');
      req.onsuccess = () => resolve(Boolean(req.result));
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * 将全部工作区状态（结单列表、手动调整、配置）加密写入 IndexedDB
 */
export async function saveToVault(data, password) {
  const db = await openDatabase();
  const encryptedPayload = await encryptData(data, password);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ id: 'vault_payload', payload: encryptedPayload, updatedAt: Date.now() });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 从 IndexedDB 读取并解密工作区数据
 */
export async function loadFromVault(password) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get('vault_payload');
    req.onsuccess = async () => {
      if (!req.result) {
        resolve(null);
        return;
      }
      try {
        const decrypted = await decryptData(req.result.payload, password);
        resolve(decrypted);
      } catch (err) {
        reject(new Error('密码不正确或数据已损坏'));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * 清空本地存储
 */
export async function clearVault() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
