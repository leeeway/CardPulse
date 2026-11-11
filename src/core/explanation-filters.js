export function filterExplanations(
  entries,
  { status = 'all', reason = 'all', query = '' } = {},
) {
  const needle = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (status === 'all' || entry.included === (status === 'included')) &&
      (reason === 'all' || entry.reason === reason) &&
      (!needle ||
        (entry.transaction.description || '').toLowerCase().includes(needle)),
  );
}
