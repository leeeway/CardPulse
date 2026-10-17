/**
 * HSBC Pulse 汇丰卓越理财 / 个人脉搏银联双币信用卡规则定义
 * 
 * 权益口径：
 * 1. 基础返现：0.4% RC（无上限，港币部分按汇率折算）
 * 2. 赏世界 5x：内地/境外人民币消费额外 2% RC（年度额度 CNY 100,000）
 * 3. PULSE 专属内地奖赏：Apple Pay 或银联二维码消费额外 2% RC（每半年额度 CNY 80,000，7月1日刷新）
 */

export const HSBC_PULSE_RULE = {
  id: 'hsbc_pulse',
  name: 'HSBC Pulse 汇丰脉搏双币信用卡',
  bank: 'HSBC_HK',
  currencies: ['CNY', 'HKD'],
  features: {
    dualCurrency: true,
    supportsApplePay: true,
    supportsUnionPayQR: true,
  },
  channels: {
    standard: { label: '普通人民币消费', pulse: false, rate: '2.4%' },
    applePay: { label: 'Apple Pay', pulse: true, rate: '4.4%' },
    unionpayQr: { label: 'UnionPay QR', pulse: true, rate: '4.4%' },
    exclude: { label: '不计返现', pulse: false, rate: '0%' }
  },
  allowances: [
    {
      id: 'world_5x',
      name: '赏世界 5x 额外奖赏',
      rate: 0.02,
      currency: 'CNY',
      cap: 100000n, // 10万人民币
      period: 'annual',
      resetDate: '01-01'
    },
    {
      id: 'pulse_promo',
      name: 'PULSE 专属内地额外奖赏',
      rate: 0.02,
      currency: 'CNY',
      cap: 80000n, // 8万人民币
      period: 'half_year',
      resetDates: ['01-01', '07-01']
    }
  ],
  detectChannel(transaction) {
    if (transaction.currency !== 'CNY') {
      return { key: 'baseOnly', pulse: false, label: '港币基础返现 (0.4%)' };
    }
    const text = `${transaction.description || ''} ${transaction.rawLine || ''} ${transaction.notes?.join(' ') || ''}`.toUpperCase();
    if (/APPLE[\s-]*PAY/.test(text)) {
      return { key: 'applePay', pulse: true, label: 'Apple Pay (4.4%)' };
    }
    if (/(?:UNION\s*PAY|银联|銀聯)/.test(text) && /\bQR\b|二维码|二維碼/.test(text)) {
      return { key: 'unionpayQr', pulse: true, label: 'UnionPay QR (4.4%)' };
    }
    const recognized = /TENPAY|ALIPAY|UNION\s*PAY/.test(text);
    return {
      key: 'standard',
      pulse: false,
      uncertain: !recognized,
      label: recognized ? '普通移动支付/银联 (2.4%)' : '待确认渠道 (默认2.4%)'
    };
  }
};
