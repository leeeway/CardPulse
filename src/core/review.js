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
    before: reviewSnapshot(transaction),
    after: reviewSnapshot({ category: nextCategory, channel: nextChannel }),
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

function reviewSnapshot({ category, channel }) {
  return {
    category: category ?? null,
    channel: channel ? { ...channel } : null,
  };
}

function sameReviewState(left, right) {
  if ((left.category ?? null) !== (right.category ?? null)) return false;
  const a = left.channel ?? null;
  const b = right.channel ?? null;
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

function restoreReviewState(transaction, target, at, action) {
  const before = reviewSnapshot(transaction);
  const after = reviewSnapshot(target);
  return {
    ...transaction,
    ...after,
    reviewHistory: [
      ...transaction.reviewHistory,
      { at, before, after, action },
    ],
  };
}

export function canRestoreImportedReview(transaction) {
  const original = transaction.reviewHistory?.[0]?.before;
  return Boolean(original && !sameReviewState(transaction, original));
}

export function restoreImportedReview(
  workspace,
  id,
  at = new Date().toISOString(),
) {
  const transaction = workspace.transactions.find((tx) => tx.id === id);
  if (!transaction) throw new Error('交易记录不存在');
  validateReviewTime(at);
  if (!canRestoreImportedReview(transaction)) return workspace;
  const restored = restoreReviewState(
    transaction,
    transaction.reviewHistory[0].before,
    at,
    'restoreImported',
  );
  return {
    ...workspace,
    transactions: workspace.transactions.map((tx) =>
      tx === transaction ? restored : tx,
    ),
  };
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

/** A session receipt can restore exactly the batch it produced, even after unrelated edits. */
export function undoBatchReview(
  workspace,
  changes,
  at = new Date().toISOString(),
) {
  validateReviewTime(at);
  const byId = new Map(changes.map((change) => [change.after.id, change]));
  let restored = 0;
  const transactions = workspace.transactions.map((tx) => {
    const change = byId.get(tx.id);
    if (!change) return tx;
    if (tx !== change.after)
      throw new Error('上次批量修正涉及的交易已改动或删除，无法整批撤销。');
    restored++;
    return restoreReviewState(tx, change.before, at, 'undoBatch');
  });
  if (restored !== byId.size)
    throw new Error('上次批量修正涉及的交易已改动或删除，无法整批撤销。');
  return restored ? { ...workspace, transactions } : workspace;
}
