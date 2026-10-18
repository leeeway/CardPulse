/** Manual review changes classification only; amounts and source evidence stay intact. */
export const REVIEW_CHANNELS = [
  'standard',
  'applePay',
  'unionpayQr',
  'online',
  'supermarket',
  'other',
  'baseOnly',
  'exclude',
];
export const categoryText = (key) =>
  ({
    __proto__: null,
    spend: '消费',
    credit: '退款',
    repayment: '还款',
    fee: '费用 / 利息',
  })[key] || '未知';
export const categoriesFor = (direction) =>
  direction === 'credit' ? ['credit', 'repayment'] : ['spend', 'fee'];

export function reviewTransaction(
  workspace,
  id,
  { category, channel },
  at = new Date().toISOString(),
) {
  const transaction = workspace.transactions.find((tx) => tx.id === id);
  if (!transaction) throw new Error('交易记录不存在');
  if (!categoriesFor(transaction.direction).includes(category))
    throw new Error('交易分类无效');
  if (!REVIEW_CHANNELS.includes(channel)) throw new Error('支付渠道无效');
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)))
    throw new Error('修改时间无效');
  if (
    transaction.category === category &&
    transaction.channel?.key === channel &&
    !transaction.channel?.uncertain
  )
    return workspace;
  const nextChannel = {
    key: channel,
    uncertain: false,
    pulse: ['applePay', 'unionpayQr'].includes(channel),
  };
  const change = {
    at,
    before: {
      category: transaction.category ?? null,
      channel: transaction.channel ? { ...transaction.channel } : null,
    },
    after: { category, channel: { ...nextChannel } },
  };
  return {
    ...workspace,
    transactions: workspace.transactions.map((tx) =>
      tx.id !== id
        ? tx
        : {
            ...tx,
            category,
            channel: nextChannel,
            reviewHistory: [...(tx.reviewHistory || []), change],
          },
    ),
  };
}
