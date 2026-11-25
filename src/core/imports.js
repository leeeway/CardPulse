/** Content identity avoids counting a renamed or re-imported PDF twice. */
export async function fingerprintFile(file, context) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const digest = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  // Standard CSV has no issuer column; identical rows can legitimately belong to different cards.
  return context && /\.csv$/i.test(file.name)
    ? `csv:${context.bankId}:${context.cardId}:${digest}`
    : digest;
}

function indexStatementTransactions(statement, fingerprint) {
  return statement.transactions.map((tx, index) => ({
    ...tx,
    id: `${fingerprint}:${index}`,
    statementId: fingerprint,
  }));
}

export function mergeStatement(workspace, statement, fingerprint) {
  const statements = workspace.statements || [];
  if (statements.some((item) => item.id === fingerprint))
    return { ...workspace, duplicate: true };
  const transactions = indexStatementTransactions(statement, fingerprint);
  const { transactions: ignored, ...summary } = statement;
  return {
    ...workspace,
    transactions: [...workspace.transactions, ...transactions],
    statements: [
      ...statements,
      { ...summary, id: fingerprint, transactionCount: transactions.length },
    ],
    duplicate: false,
  };
}

const SOURCE_FIELDS = [
  'day',
  'transactionDay',
  'description',
  'amount',
  'currency',
  'direction',
  'last4',
  'bankId',
  'ruleId',
  'rawLine',
];

/** Check saved row positions against the original parse before staging the gaps. */
export function stageStatementSupplement(workspace, parsed, fingerprint) {
  const statement = workspace.statements.find(({ id }) => id === fingerprint);
  const skippedCount = statement?.skippedTransactionCount;
  const invalid = '原文件的解析结果与已入账记录不一致，无法安全补录。';
  if (
    !skippedCount ||
    parsed.bankId !== statement.bankId ||
    parsed.ruleId !== statement.ruleId ||
    parsed.transactions.length !== statement.transactionCount + skippedCount
  )
    throw new Error(invalid);

  const original = indexStatementTransactions(parsed, fingerprint);
  const originalById = new Map(original.map((tx) => [tx.id, tx]));
  const existingIds = new Set(workspace.transactions.map(({ id }) => id));
  const alreadyImported = workspace.transactions.filter((tx) =>
    belongsToStatement(tx, fingerprint),
  );
  for (const tx of alreadyImported) {
    const source = originalById.get(tx.id);
    if (
      !source ||
      SOURCE_FIELDS.some((key) => (source[key] ?? '') !== (tx[key] ?? '')) ||
      source.sources?.[0]?.row !== tx.sources?.[0]?.row ||
      source.sources?.[0]?.page !== tx.sources?.[0]?.page
    )
      throw new Error(invalid);
  }
  const missing = original.filter(({ id }) => !existingIds.has(id));
  if (
    alreadyImported.length !== statement.transactionCount ||
    missing.length !== skippedCount
  )
    throw new Error(invalid);

  const { skippedTransactionCount: ignored, ...rest } = statement;
  return {
    ...workspace,
    transactions: [...workspace.transactions, ...missing],
    statements: workspace.statements.map((row) =>
      row === statement ? { ...rest, transactionCount: original.length } : row,
    ),
  };
}

/** Keep staged transaction IDs and the original reconciliation for partial imports. */
export function applyStatementImportSelection(
  workspace,
  pendingTransactionIds,
  skippedIds,
) {
  if (!skippedIds.size) return workspace;
  const skippedByStatement = new Map();
  const transactions = workspace.transactions.filter((transaction) => {
    const { id, statementId } = transaction;
    if (!pendingTransactionIds.has(id) || !skippedIds.has(id)) return true;
    skippedByStatement.set(
      statementId,
      (skippedByStatement.get(statementId) || 0) + 1,
    );
    return false;
  });
  if (!skippedByStatement.size) return workspace;
  const statements = workspace.statements.flatMap((statement) => {
    const skipped = skippedByStatement.get(statement.id);
    if (!skipped) return [statement];
    const retained = statement.transactionCount - skipped;
    return retained > 0
      ? [
          {
            ...statement,
            transactionCount: retained,
            skippedTransactionCount: skipped,
          },
        ]
      : [];
  });
  return { ...workspace, transactions, statements };
}

/** New records carry an explicit link; legacy imports used fingerprint:index IDs. */
export function belongsToStatement(transaction, statementId) {
  if (transaction.statementId != null)
    return transaction.statementId === statementId;
  const prefix = `${statementId}:`;
  return (
    transaction.id.startsWith(prefix) &&
    /^\d+$/.test(transaction.id.slice(prefix.length))
  );
}

export function removeStatement(workspace, statementId) {
  if (!workspace.statements.some((statement) => statement.id === statementId))
    return workspace;
  return {
    ...workspace,
    statements: workspace.statements.filter(
      (statement) => statement.id !== statementId,
    ),
    transactions: workspace.transactions.filter(
      (tx) => !belongsToStatement(tx, statementId),
    ),
  };
}
