import { HSBC_PULSE_RULE } from './hsbc_pulse.js';
import { HSBC_RED_RULE } from './hsbc_red.js';

export const CARD_RULES = {
  [HSBC_PULSE_RULE.id]: HSBC_PULSE_RULE,
  [HSBC_RED_RULE.id]: HSBC_RED_RULE,
};

/**
 * 根据结单特征匹配最合适的规则
 * @param {string} text 结单文本
 * @param {string[]} currencies 包含的币种
 * @returns {object} 匹配到的规则对象
 */
export function matchCardRule(text = '', currencies = []) {
  const upper = text.toUpperCase();
  if (currencies.includes('CNY') && currencies.includes('HKD')) {
    return HSBC_PULSE_RULE;
  }
  if (upper.includes('PULSE') || upper.includes('UNIONPAY')) {
    return HSBC_PULSE_RULE;
  }
  if (upper.includes('RED CARD') || upper.includes('REDCARD')) {
    return HSBC_RED_RULE;
  }
  // 默认使用广泛适用的 Pulse 双币规则
  return HSBC_PULSE_RULE;
}
