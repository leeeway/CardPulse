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
export const MAX_BATCH_REVIEW = 100;

function applyReview(transaction, { category, channel }, at) {
  if (
    category !== undefined &&
    !categoriesFor(transaction.direction).includes(category)
  )
    throw new Error('交易分类无效');
  if (channel !== undefined && !REVIEW_CHANNELS.includes(channel))
    throw new Error('支付渠道无效');
  const categoryChanged =
    category !== undefined && category !== transaction.category;
  const channelChanged =
    channel !== undefined &&
    (transaction.channel?.key !== channel || transaction.channel?.uncertain);
  if (!categoryChanged && !channelChanged) return transaction;

  const nextChannel =
    channel === undefined
      ? transaction.channel
      : {
          key: channel,
          uncertain: false,
          pulse: ['applePay', 'unionpayQr'].includes(channel),
        };
  const nextCategory = category === undefined ? transaction.category : category;
  const change = {
    at,
    before: {
      category: transaction.category ?? null,
      channel: transaction.channel ? { ...transaction.channel } : null,
    },
    after: {
      category: nextCategory ?? null,
      channel: nextChannel ? { ...nextChannel } : null,
    },
  };
  return {
    ...transaction,
    ...(category !== undefined ? { category: nextCategory } : {}),
    ...(channel !== undefined ? { channel: nextChannel } : {}),
    reviewHistory: [...(transaction.reviewHistory || []), change],
  };
}

function validateReviewTime(at) {
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)))
    throw new Error('修改时间无效');
}

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
  validateReviewTime(at);
  const updated = applyReview(transaction, { category, channel }, at);
  if (updated === transaction) return workspace;
  return {
    ...workspace,
    transactions: workspace.transactions.map((tx) =>
      tx.id === id ? updated : tx,
    ),
  };
}

/** Build an atomic preview from the selected rows. An omitted field is preserved. */
export function reviewTransactions(
  workspace,
  ids,
  patch,
  at = new Date().toISOString(),
) {
  const selected = new Set(ids);
  if (!selected.size || selected.size > MAX_BATCH_REVIEW)
    throw new Error('每次批量核对可选择 1 至 100 笔交易');
  validateReviewTime(at);
  let found = 0;
  const changes = [];
  const transactions = workspace.transactions.map((tx) => {
    if (!selected.has(tx.id)) return tx;
    found++;
    if (patch.channel === 'baseOnly' && tx.currency !== 'HKD')
      throw new Error('港币基础渠道仅适用于港币交易');
    const updated = applyReview(tx, patch, at);
    if (updated !== tx) changes.push({ before: tx, after: updated });
    return updated;
  });
  if (found !== selected.size) throw new Error('交易记录不存在');
  return {
    workspace: changes.length ? { ...workspace, transactions } : workspace,
    changes,
  };
}
