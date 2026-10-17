import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintFile, mergeStatement } from '../src/core/imports.js';

it('同内容改名后导入不会重复计账，同名不同内容保留不同交易 ID', async () => {
  const first = new File(['pdf content'], 'a.pdf');
  const renamed = new File(['pdf content'], 'b.pdf');
  const different = new File(['different content'], 'a.pdf');
  const hash = await fingerprintFile(first);
  assert.equal(hash, await fingerprintFile(renamed));
  const statement = { fileName: first.name, transactions: [{ id: 'old', amount: '10.00' }], warnings: [] };
  const workspace = mergeStatement({ transactions: [], statements: [] }, statement, hash);
  const duplicate = mergeStatement(workspace, statement, await fingerprintFile(renamed));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.transactions.length, 1);
  const merged = mergeStatement(workspace, statement, await fingerprintFile(different));
  assert.equal(merged.transactions.length, 2);
  assert.notEqual(merged.transactions[0].id, merged.transactions[1].id);
  assert.equal(merged.statements[0].transactionCount, 1);
  assert.equal(statement.transactions[0].id, 'old');
});
