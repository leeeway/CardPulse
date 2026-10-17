// Synthetic statement with no real cardholder or transaction data.
export function makeStatementPdf(amount = '50.00') {
  const texts = [
    [10, 780, 'STATEMENT DATE 10 JAN 2026 CNY'],
    [10, 770, '6222 XXXX XXXX 1234'],
    [10, 750, 'POST DATE TRANS DATE DESCRIPTION AMOUNT'],
    [230, 740, 'PREVIOUS BALANCE 100.00'],
    [10, 720, '02 JAN'],
    [170, 720, '02 JAN'],
    [230, 720, 'TEST SHOP'],
    [850, 720, amount],
    [230, 700, `CLOSING BALANCE ${(100 + Number(amount)).toFixed(2)}`],
  ];
  const stream = texts
    .map(([x, y, text]) => `BT /F1 10 Tf ${x} ${y} Td (${text}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = Buffer.byteLength(out);
  out += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n `)
    .join(
      '\n',
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(out);
}
