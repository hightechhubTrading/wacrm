export function quotationPathValid(
  id: string,
  revision: number,
  path: unknown
) {
  return (
    typeof path === 'string' &&
    new RegExp(
      `^${id}/rev-${revision}(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\\.pdf$`,
      'i'
    ).test(path)
  );
}
