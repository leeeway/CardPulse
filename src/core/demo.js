/**
 * 示例演示数据（完全虚构，供用户快速体验）
 */

export const DEMO_TRANSACTIONS = [
  {
    id: 'demo-1',
    day: '2026-03-12',
    transactionDay: '2026-03-12',
    description: 'APPLE STORE RETAIL TAIGULI',
    amount: '12999.00',
    direction: 'debit',
    currency: 'CNY',
    category: 'spend',
    notes: ['APPLE PAY TRANSACTION'],
    channel: { key: 'applePay', pulse: true, label: 'Apple Pay (4.4%)' },
    last4: '8812',
    sources: [{ fileName: 'Demo_Pulse_Statement.pdf', page: 1 }]
  },
  {
    id: 'demo-2',
    day: '2026-03-15',
    transactionDay: '2026-03-15',
    description: 'SAM CLUB SHANGHAI PUDONG',
    amount: '1850.50',
    direction: 'debit',
    currency: 'CNY',
    category: 'spend',
    notes: ['UNIONPAY QR CODE'],
    channel: { key: 'unionpayQr', pulse: true, label: 'UnionPay QR (4.4%)' },
    last4: '8812',
    sources: [{ fileName: 'Demo_Pulse_Statement.pdf', page: 1 }]
  },
  {
    id: 'demo-3',
    day: '2026-03-20',
    transactionDay: '2026-03-19',
    description: 'MEITUAN WAIMAI BEIJING',
    amount: '158.00',
    direction: 'debit',
    currency: 'CNY',
    category: 'spend',
    notes: ['TENPAY / WECHAT PAY'],
    channel: { key: 'standard', pulse: false, label: '普通移动支付 (2.4%)' },
    last4: '8812',
    sources: [{ fileName: 'Demo_Pulse_Statement.pdf', page: 1 }]
  },
  {
    id: 'demo-4',
    day: '2026-03-22',
    transactionDay: '2026-03-21',
    description: 'STARBUCKS COFFEE CENTRAL HK',
    amount: '88.00',
    direction: 'debit',
    currency: 'HKD',
    category: 'spend',
    notes: ['CONTACTLESS'],
    channel: { key: 'baseOnly', pulse: false, label: '港币基础返现 (0.4%)' },
    last4: '8812',
    sources: [{ fileName: 'Demo_Pulse_Statement.pdf', page: 2 }]
  },
  {
    id: 'demo-5',
    day: '2026-03-28',
    transactionDay: '2026-03-28',
    description: 'AUTOPAY PAYMENT RECEIVED - THANK YOU',
    amount: '15007.50',
    direction: 'credit',
    currency: 'CNY',
    category: 'repayment',
    notes: [],
    channel: { key: 'exclude', pulse: false, label: '还款 (不计返现)' },
    last4: '8812',
    sources: [{ fileName: 'Demo_Pulse_Statement.pdf', page: 2 }]
  }
];
