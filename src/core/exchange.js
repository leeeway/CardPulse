/**
 * 公开参考汇率获取模块
 * 采用 Frankfurter 公开日度参考汇率，严格剔除敏感凭证与 Referrer
 */

export const RATE_SOURCE_URL = 'https://api.frankfurter.dev/v2/rate/HKD/CNY';

export async function fetchHkdCnyRate({ signal } = {}) {
  try {
    const res = await fetch(RATE_SOURCE_URL, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = Number(data.rates?.CNY || data.rate);
    if (!(rate > 0) || !Number.isFinite(rate)) {
      throw new Error('返回的汇率无效');
    }
    return {
      rate,
      date: data.date || new Date().toISOString().slice(0, 10),
      source: 'Frankfurter'
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      rate: null,
      date: '汇率暂不可用',
      isFallback: true
    };
  }
}
