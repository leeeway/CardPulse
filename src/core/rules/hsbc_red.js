/**
 * HSBC Red 汇丰 Red 信用卡规则定义
 * 
 * 权益口径：
 * 1. 网上签账：4% RC（每月最高 HKD 10,000 签账额，即最高 HKD 400 RC）
 * 2. 指定本地超市：2% RC
 * 3. 其他本地及海外签账：1% RC（无上限）
 */

export const HSBC_RED_RULE = {
  id: 'hsbc_red',
  name: 'HSBC Red 汇丰 Red 信用卡',
  bank: 'HSBC_HK',
  currencies: ['HKD'],
  features: {
    dualCurrency: false,
    supportsOnlineShopping: true
  },
  channels: {
    online: { label: '网上合资格签账', rate: '4.0%' },
    supermarket: { label: '本地指定超市', rate: '2.0%' },
    other: { label: '其他基本签账', rate: '1.0%' },
    exclude: { label: '不计奖赏', rate: '0%' }
  },
  allowances: [
    {
      id: 'red_online',
      name: '网购 4% 额外奖赏',
      rate: 0.04,
      currency: 'HKD',
      monthlyCap: 10000n, // 每月1万港币
      period: 'monthly'
    }
  ],
  detectChannel(transaction) {
    const text = `${transaction.description || ''} ${transaction.rawLine || ''}`.toUpperCase();
    if (/ONLINE|INTERNET|PAYPAL|APPLE\.COM|GOOGLE|AMAZON|JD\.COM|TAOBAO/.test(text)) {
      return { key: 'online', label: '网上签账 (4.0%)' };
    }
    if (/PARKNSHOP|WELLCOME|CITYSUPER|DON DON DONKI|MARKET PLACE/.test(text)) {
      return { key: 'supermarket', label: '指定超市 (2.0%)' };
    }
    return { key: 'other', label: '基本签账 (1.0%)' };
  }
};
