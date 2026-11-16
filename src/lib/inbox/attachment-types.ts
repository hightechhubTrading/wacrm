/** Matches the existing chat-media bucket and WhatsApp photo/document types. */
export const attachmentTypes: Record<
  string,
  { mime: string; kind: 'image' | 'document' }
> = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  pdf: { mime: 'application/pdf', kind: 'document' },
  txt: { mime: 'text/plain', kind: 'document' },
  doc: { mime: 'application/msword', kind: 'document' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
  },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document' },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'document',
  },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'document' },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
  },
};
export const attachmentAccept = Object.keys(attachmentTypes)
  .map((ext) => `.${ext}`)
  .join(',');
export const attachmentLimit = (kind: string) =>
  (kind === 'image' ? 5 : 16) * 1024 * 1024;
export function attachmentType(name: string, mime: string) {
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  const type = Object.hasOwn(attachmentTypes, ext)
    ? attachmentTypes[ext]
    : null;
  if (
    !type ||
    (mime &&
      mime !== 'application/octet-stream' &&
      mime.split(';')[0].toLowerCase() !== type.mime)
  )
    return null;
  return { ...type, ext };
}
export function cleanAttachmentName(name: string) {
  return name
    .replace(/[\x00-\x1f\x7f/\\]/g, '_')
    .trim()
    .slice(-180);
}
