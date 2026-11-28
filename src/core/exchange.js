/**
 * 公开参考汇率获取模块
 * 采用 Frankfurter 公开日度参考汇率，严格剔除敏感凭证与 Referrer
 */

import { isIsoDate } from './campaigns.js';

export const RATE_SOURCE_URL = 'https://api.frankfurter.dev/v2/rate/HKD/CNY';
export const MAX_EXCHANGE_RATE = 10000;

export function isValidExchangeRate(info) {
  return (
    Number.isFinite(info?.rate) &&
    info.rate > 0 &&
    info.rate <= MAX_EXCHANGE_RATE &&
    isIsoDate(info.date) &&
    ['manual', 'Frankfurter'].includes(info.source)
  );
}

export async function fetchHkdCnyRate({ signal } = {}) {
  try {
    if (globalThis.cardpulseDesktop) {
      const info = await globalThis.cardpulseDesktop.fetchReferenceRate();
      if (!isValidExchangeRate(info)) throw new Error('返回的汇率无效');
      return info;
    }
    const res = await fetch(RATE_SOURCE_URL, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const info = {
      rate: Number(data.rates?.CNY ?? data.rate),
      date: data.date || new Date().toISOString().slice(0, 10),
      source: 'Frankfurter',
    };
    if (!isValidExchangeRate(info)) throw new Error('返回的汇率无效');
    return info;
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      rate: null,
      date: '汇率暂不可用',
      isFallback: true,
    };
  }
}
