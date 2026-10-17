/**
 * Web Crypto API 端侧零知识加密工具
 * 使用 PBKDF2 密钥派生 + AES-GCM-256 对称加密
 * 确保所有卡号与结单账目在本地持久化时均为加密密文，私钥永不离端
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 从密码和盐值派生 AES-GCM 密钥
 */
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * 加密对象或字符串
 * @returns {Promise<string>} 格式: saltHex:ivHex:ciphertextHex
 */
export async function encryptData(data, password) {
  if (!password) throw new Error('加密必须提供密码');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);

  const enc = new TextEncoder();
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );

  return `${bufferToHex(salt)}:${bufferToHex(iv)}:${bufferToHex(encrypted)}`;
}

/**
 * 解密密文
 * @param {string} payload 格式: saltHex:ivHex:ciphertextHex
 */
export async function decryptData(payload, password) {
  if (!password) throw new Error('解密必须提供密码');
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('密文格式无效');

  const [saltHex, ivHex, ciphertextHex] = parts;
  const salt = hexToBuffer(saltHex);
  const iv = hexToBuffer(ivHex);
  const ciphertext = hexToBuffer(ciphertextHex);

  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const dec = new TextDecoder();
  const text = dec.decode(decrypted);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
