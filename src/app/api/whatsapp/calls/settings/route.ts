import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  callingAdmin,
  callingConfig,
  readCallingBody,
} from '@/lib/whatsapp/calling/server';
import { CallingError, callingRequest } from '@/lib/whatsapp/calling/meta';

export const maxDuration = 30;

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const config = await callingConfig(ctx.accountId, false);
    // Browser only receives the public enabled flag, never tokens or SIP keys.
    return NextResponse.json(
      { enabled: config.calling_enabled },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await readCallingBody(request);
    if (typeof body.enabled !== 'boolean')
      throw new CallingError('enabled must be a boolean.');
    const config = await callingConfig(ctx.accountId, false);
    if (body.enabled) {
      const settings = await callingRequest<{
        calling?: { status?: string; sip?: { status?: string } };
      }>(config, 'settings');
      if (settings.calling?.status !== 'ENABLED')
        throw new CallingError(
          'Enable voice calls for this number in WhatsApp Manager first.',
          409
        );
      if (settings.calling.sip?.status === 'ENABLED')
        throw new CallingError(
          'Disable SIP in WhatsApp Manager to use browser calling.',
          409
        );
    }
    const { error } = await callingAdmin()
      .from('whatsapp_config')
      .update({ calling_enabled: body.enabled })
      .eq('account_id', ctx.accountId);
    if (error) throw new CallingError('Could not save calling settings.', 500);
    return NextResponse.json({ enabled: body.enabled });
  } catch (error) {
    return toErrorResponse(error);
  }
}
