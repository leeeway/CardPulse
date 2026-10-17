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

// Synthetic PDF encrypted with the public test password: pdf-password.
export function makeEncryptedStatementPdf() {
  return Buffer.from(
    'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwK' +
      'L1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFy' +
      'ZW50IDIgMCBSCi9NZWRpYUJveCBbIDAgMCAxMDAwIDgwMCBdCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0YxIDQgMCBSCj4+Cj4+' +
      'Ci9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250' +
      'IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0xlbmd0aCA0NTEKPj4Kc3RyZWFtCpeHw+qWRPb+UHWrhmPabg7R35I0' +
      'mhEiI7vbf7v9P31xxs824X5x9oGrKzNr0YzMgcTYFbjf3sAmdPMjP4X477rEyGBi6pr9SAPSYPYV1Qo88CQVQTGV52BrcRgmFX7F' +
      'amvtjA7TwtWDlpPEuq1q6fVXmm9kCK33a6ywJBBHCIoTR6Cy2OyZG8e2TIatzYe/WM9pIOjqqOWAgq8lq+cem0WPxigNBUyCnltx' +
      'u5wnEiavKQmzdpYo48eb+QfpwfUON1FaDa+g0lzyOu39xhgUtsS7ukxsTOYM+9TjiuD22URs7Z4zLJgcJOU4nvns6nv8W/vyd8m2' +
      'zCRVLJJI28aE0e5lp8zACJS8KAutXA3337lmyipQknagqt/tGJgoIwEft2wf7Tq8YgcMlVdz2/uJOMWFqAL9qm6dyufDZiqLtHVk' +
      '37VNd2fHYI4E5AfQsDocCcX5MkUirU85OFaAopJrUScJVvePJ2u5BKrgNn1dOa75rrzOvpbfBWctkhixDioSwNo3335QZrDCW5xs' +
      '3yV859HVgEBbEVG5M8bN7caooD8fflD8wNNZyRoC7/MO40renHK8KarM2jwAkb3PZYCi7h3oLv0KZW5kc3RyZWFtCmVuZG9iago2' +
      'IDAgb2JqCjw8Ci9WIDIKL1IgMwovTGVuZ3RoIDEyOAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDw2OGYzMGIw' +
      'ZDA1OTQ4NWY1OTViNWU2NGI4Mzc1YTQzMGEzNDQ1OTMxODhiOWMwMzZmYmI4OWE4OWQ2ZDk3ODIyPgovVSA8OTdlZmE2NDc5M2Fl' +
      'MDFmNzY0NDBiMjBiMWE1ZWVlZTkyOGJmNGU1ZTRlNzU4YTQxNjQwMDRlNTZmZmZhMDEwOD4KPj4KZW5kb2JqCnhyZWYKMCA3CjAw' +
      'MDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjMgMDAwMDAg' +
      'biAKMDAwMDAwMDI1MiAwMDAwMCBuIAowMDAwMDAwMzIyIDAwMDAwIG4gCjAwMDAwMDA4MjQgMDAwMDAgbiAKdHJhaWxlcgo8PAov' +
      'U2l6ZSA3Ci9Sb290IDEgMCBSCi9JRCBbIDw2MTMxNjQ2MjY2NjEzMTM0MzczMjM2NjUzODM3NjQ2NTY0MzMzNjYxMzg2MjM5NjQz' +
      'ODY1MzczNzM0MzA2NTM3PiA8NjEzMTY0NjI2NjYxMzEzNDM3MzIzNjY1MzgzNzY0NjU2NDMzMzY2MTM4NjIzOTY0Mzg2NTM3Mzcz' +
      'NDMwNjUzNz4gXQovRW5jcnlwdCA2IDAgUgo+PgpzdGFydHhyZWYKMTAzOQolJUVPRgo=',
    'base64',
  );
}
