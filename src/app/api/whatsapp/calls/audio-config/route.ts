import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { callingConfig } from '@/lib/whatsapp/calling/server';
import { CallingError } from '@/lib/whatsapp/calling/meta';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    await callingConfig(ctx.accountId);
    // Optional STUN/TURN infrastructure. These credentials are intentionally
    // delivered to an authenticated browser, as required by WebRTC. Use
    // restricted/short-lived TURN credentials when configuring production.
    const iceServers = process.env.WHATSAPP_CALLING_ICE_SERVERS_JSON
      ? JSON.parse(process.env.WHATSAPP_CALLING_ICE_SERVERS_JSON)
      : [{ urls: 'stun:stun.l.google.com:19302' }];
    if (!Array.isArray(iceServers))
      throw new CallingError('Invalid calling ICE configuration.', 503);
    return NextResponse.json(
      { iceServers },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
