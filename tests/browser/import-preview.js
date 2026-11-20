export const statementImportPreview = (page) =>
  page.getByRole('dialog', { name: /^(账单导入预览|結單匯入預覽)$/ });

export async function confirmStatementImport(page) {
  await statementImportPreview(page)
    .getByRole('button', { name: /^(确认导入|確認匯入)$/ })
    .click();
}
