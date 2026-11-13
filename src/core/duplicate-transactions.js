import { bankOf } from './banks.js';
import { cents } from './reconciliation.js';
import { isIsoDate } from './campaigns.js';

/** Advisory only: equal posted evidence across known statements is not proof of duplication. */
export function findPotentialDuplicates(transactions, statements) {
  const sources = new Map(
    statements.map((statement) => [statement.id, statement]),
  );
  const candidates = new Map();
  let checkedCount = 0;
  for (const transaction of transactions) {
    if (
      !transaction ||
      !isIsoDate(transaction.day) ||
      !['debit', 'credit'].includes(transaction.direction) ||
      !['CNY', 'HKD'].includes(transaction.currency) ||
      typeof transaction.description !== 'string'
    )
      continue;
    const merchant = transaction.description
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    const legacy =
      typeof transaction.id === 'string'
        ? transaction.id.match(/^(.*):\d+$/)?.[1]
        : null;
    const source = sources.get(transaction.statementId ?? legacy);
    if (!source || !merchant) continue;
    let amount;
    try {
      amount = cents(transaction.amount);
    } catch {
      continue;
    }
    if (amount <= 0n) continue;
    checkedCount++;
    const key = JSON.stringify([
      bankOf(transaction),
      transaction.ruleId || '',
      transaction.last4 || '',
      transaction.day,
      transaction.currency,
      transaction.direction,
      amount.toString(),
      merchant,
    ]);
    const group = candidates.get(key) || {
      key,
      entries: [],
      statementIds: new Set(),
    };
    group.entries.push({ transaction, statement: source });
    group.statementIds.add(source.id);
    candidates.set(key, group);
  }
  const groups = [...candidates.values()]
    .filter((group) => group.statementIds.size > 1)
    .map(({ key, entries }) => ({ key, entries }));
  return {
    groups,
    checkedCount,
    skippedCount: transactions.length - checkedCount,
  };
}
