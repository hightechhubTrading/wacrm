const uuid =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const photoIdValid = (id: string) =>
  new RegExp(`^${uuid}$`, 'i').test(id);
export function contactPhotoUrl(id: string, version: string) {
  return `/api/contacts/${id}/photo?v=${version}`;
}
export function contactPhotoVersion(
  url: string | null | undefined,
  id: string
) {
  if (!url) return 'none';
  const match = new RegExp(
    `^/api/contacts/${id}/photo\\?v=(${uuid})$`,
    'i'
  ).exec(url);
  return match?.[1] ?? 'legacy';
}
export function contactPhotoPath(account: string, id: string, version: string) {
  return `${account}/${id}/${version}.webp`;
}
