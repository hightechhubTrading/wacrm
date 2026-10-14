import { uploadResumableMedia } from '@/lib/whatsapp/meta-api'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE header — a plain public
 * URL is not accepted at creation time. This helper turns the template's
 * `header_media_url` (whether the user uploaded a file or pasted a link)
 * into a handle and writes it onto the payload, so both the upload path
 * and the legacy URL path actually succeed.
 *
 * No-op unless the header is an image that has a URL but no handle yet.
 * Image-only for now (the #230 scope); video/document handles can follow
 * the same shape.
 */

// Meta's image-header sample limits.
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png']
const IMAGE_FETCH_TIMEOUT_MS = 15_000

function tooLargeMessage(bytes: number): string {
  return `Header image is ${(bytes / 1024 / 1024).toFixed(1)} MB — Meta's limit is 5 MB.`
}

/**
 * Read a response body under a hard byte cap. `content-length` is
 * advisory (absent or spoofable), so the cap is enforced while
 * streaming — the body is never fully buffered past `maxBytes`, which
 * avoids a memory-exhaustion DoS from a URL pointing at a huge
 * response.
 */
async function readBodyWithCap(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) throw new Error(tooLargeMessage(buf.byteLength))
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(tooLargeMessage(total))
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function ensureImageHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
): Promise<void> {
  if (payload.header_type !== 'image') return
  if (payload.header_handle) return // already have one
  if (!payload.header_media_url) return // validator already requires url-or-handle

  const appId = process.env.META_APP_ID
  if (!appId) {
    throw new Error(
      'Image-header templates need META_APP_ID set (used for Meta’s Resumable Upload). Add it to your environment, or remove the image header.',
    )
  }

  // The URL is caller-supplied (uploaded chat-media URL or a pasted
  // public link), so it is an SSRF primitive unless we refuse
  // private/loopback/link-local hosts — the same guard the webhook
  // delivery path uses.
  if (!(await isDeliverableUrl(payload.header_media_url))) {
    throw new Error('Header image URL must be a publicly reachable address.')
  }

  // Fetch the sample image bytes (works for our uploaded chat-media URL
  // and for a manually-pasted public link). `redirect: 'manual'` stops a
  // public URL from 3xx-bouncing to an internal one; the timeout bounds
  // a slow/hanging host.
  let res: Response
  try {
    res = await fetch(payload.header_media_url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new Error('Could not fetch the header image URL. Make sure it is publicly reachable.')
  }
  if (!res.ok) {
    throw new Error(`Header image URL returned ${res.status}. It must be publicly reachable.`)
  }

  const declaredLength = Number(res.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > IMAGE_MAX_BYTES) {
    throw new Error(tooLargeMessage(declaredLength))
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !ALLOWED_IMAGE_TYPES.includes(contentType)) {
    throw new Error(`Header image must be JPEG or PNG (got ${contentType}).`)
  }

  const bytes = await readBodyWithCap(res, IMAGE_MAX_BYTES)
  if (bytes.byteLength === 0) {
    throw new Error('Header image is empty.')
  }

  const mimeType = ALLOWED_IMAGE_TYPES.includes(contentType) ? contentType : 'image/jpeg'
  const fileName = mimeType === 'image/png' ? 'header.png' : 'header.jpg'

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  })
  payload.header_handle = handle
}
