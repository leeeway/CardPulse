import { HSBC_PULSE_RULE } from './hsbc_pulse.js';
import { HSBC_RED_RULE } from './hsbc_red.js';
import { BANKS } from '../banks.js';

const genericRule = (bank) => ({
  id: `${bank.id}_custom`,
  bankId: bank.id,
  name: bank.name,
  detectChannel: () => ({
    key: 'standard',
    uncertain: true,
    label: '待确认渠道',
  }),
});
export const CARD_RULES = {
  hsbc_pulse: { ...HSBC_PULSE_RULE, bankId: 'hsbc' },
  hsbc_red: { ...HSBC_RED_RULE, bankId: 'hsbc' },
  ...Object.fromEntries(
    BANKS.map((bank) => [`${bank.id}_custom`, genericRule(bank)]),
  ),
};

/** Never assume a different or unidentified bank uses Pulse rewards. */
export function matchCardRule(text = '') {
  const patterns = [
    ['bochk', /\bBOCHK\b|BANK OF CHINA|中[银銀]|中國銀行|中国银行/i],
    ['cncb', /\bCNCBI?\b|CITIC|信[银銀]/i],
    ['hangseng', /HANG\s*SENG|恒生/i],
    ['sc', /STANDARD\s*CHARTERED|渣打/i],
    ['citi', /CITIBANK|\bCITI\b|花旗/i],
    ['dbs', /\bDBS\b|星展/i],
  ];
  for (const [bankId, pattern] of patterns)
    if (pattern.test(text)) return CARD_RULES[`${bankId}_custom`];
  if (/\bRED\s*CARD\b/i.test(text)) return CARD_RULES.hsbc_red;
  if (/\bPULSE\b/i.test(text)) return CARD_RULES.hsbc_pulse;
  if (/\bHSBC\b|[汇滙匯]豐|汇丰/i.test(text)) return CARD_RULES.hsbc_custom;
  return CARD_RULES.other_custom;
}
