export function escapeCsvCell(value) {
  let text = value == null ? '' : String(value).trim();
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
