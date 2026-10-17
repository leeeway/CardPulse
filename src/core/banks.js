/** Identity and import capabilities only; no unverified bank reward rates. */
export const BANKS = [
  {
    id: 'hsbc',
    short: 'HSBC',
    name: '汇丰',
    traditional: '滙豐',
    color: '#db0011',
    url: 'https://www.hsbc.com.hk/credit-cards/products/red/',
    pdf: true,
    cards: ['hsbc_pulse', 'hsbc_red'],
  },
  {
    id: 'bochk',
    short: 'BOC',
    name: '中银香港',
    traditional: '中銀香港',
    color: '#b51b2d',
    url: 'https://www.bochk.com/dam/boccreditcard/cheerscard_622/chi/index.html',
  },
  {
    id: 'cncb',
    short: 'CNCBI',
    name: '信银国际',
    traditional: '信銀國際',
    color: '#bd2639',
    url: 'https://www.cncbinternational.com/personal/credit-cards/tc-credit-card-application/en/tc.html',
  },
  {
    id: 'hangseng',
    short: 'HASE',
    name: '恒生',
    traditional: '恒生',
    color: '#00845a',
    url: 'https://www.hangseng.com/en-hk/resources/important-documents/cards/',
  },
  {
    id: 'sc',
    short: 'SC',
    name: '渣打',
    traditional: '渣打',
    color: '#0678b5',
    url: 'https://www.sc.com/hk/credit-cards/terms-and-conditions/',
  },
  {
    id: 'citi',
    short: 'CITI',
    name: '花旗',
    traditional: '花旗',
    color: '#075ba6',
    url: 'https://www.citibank.com.hk/english/credit-cards/useful-document/',
  },
  {
    id: 'dbs',
    short: 'DBS',
    name: '星展',
    traditional: '星展',
    color: '#a91d2b',
    url: 'https://www.dbs.com.hk/personal/credit-cards/cardTnC.page',
  },
  {
    id: 'other',
    short: 'CARD',
    name: '其他银行',
    traditional: '其他銀行',
    color: '#6554b4',
  },
];
export const getBank = (id) => BANKS.find((bank) => bank.id === id);
export const bankOf = (tx) =>
  tx.bankId ||
  (tx.ruleId?.startsWith('hsbc_') || !tx.ruleId ? 'hsbc' : 'other');
export const cardsFor = (bankId) =>
  getBank(bankId)?.cards || [`${bankId}_custom`];
export const cardName = (id) =>
  ({ hsbc_pulse: 'HSBC Pulse', hsbc_red: 'HSBC Red' })[id] || '自定义卡片';
