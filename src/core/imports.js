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

export function mergeStatement(workspace, statement, fingerprint) {
  const statements = workspace.statements || [];
  if (statements.some((item) => item.id === fingerprint))
    return { ...workspace, duplicate: true };
  const transactions = statement.transactions.map((tx, index) => ({
    ...tx,
    id: `${fingerprint}:${index}`,
    statementId: fingerprint,
  }));
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
