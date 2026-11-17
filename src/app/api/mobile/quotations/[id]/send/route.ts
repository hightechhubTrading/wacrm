import {
  mobileQuotation,
  currentQuotationDocument,
} from '@/lib/mobile/quotations';
import { mobileResponse, mobilePreflight } from '@/lib/mobile/conversation';
import { canSendMessages } from '@/lib/auth/roles';
import { dispatchQuotation } from '@/lib/quotations/dispatch';
import { isOperationId } from '@/lib/whatsapp/send-operations';
export const OPTIONS = mobilePreflight;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const fail = (status: number, error: string) =>
    mobileResponse(request, Response.json({ error }, { status }));
  try {
    const access = await mobileQuotation(request, (await params).id);
    if ('response' in access) return access.response;
    if (!canSendMessages(access.profile.account_role))
      return fail(403, 'Sending requires an agent role');
    const reader = request.body?.getReader();
    if (!reader)
      return fail(400, 'Confirm the recipient and PDF before sending');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 8192) {
          await reader.cancel();
          return fail(413, 'Message too large');
        }
        chunks.push(p.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (
      !body ||
      body.confirmed !== true ||
      !isOperationId(body.documentId) ||
      !isOperationId(body.conversationId) ||
      typeof body.caption !== 'string' ||
      body.caption.length > 1024 ||
      !Number.isSafeInteger(body.workspaceVersion) ||
      Object.keys(body).some(
        (k) =>
          ![
            'confirmed',
            'documentId',
            'conversationId',
            'caption',
            'workspaceVersion',
          ].includes(k)
      )
    )
      return fail(400, 'Confirm a valid recipient, current PDF and caption');
    const document = await currentQuotationDocument(access);
    if (
      !document ||
      document.id !== body.documentId ||
      document.workspace_version !== body.workspaceVersion
    )
      return fail(409, 'Quotation changed. Refresh before sending.');
    return mobileResponse(
      request,
      await dispatchQuotation(
        {
          supabase: access.db,
          userId: access.user.id,
          accountId: access.profile.account_id,
        },
        access.quotation.id,
        body
      )
    );
  } catch (e) {
    return fail(
      e instanceof SyntaxError ? 400 : 503,
      e instanceof SyntaxError
        ? 'Invalid confirmation'
        : 'Quotation sending could not be confirmed. Refresh its status before trying again.'
    );
  }
}
