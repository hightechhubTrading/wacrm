import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { callingConfig } from '@/lib/whatsapp/calling/server';
import { callingIceServers } from '@/lib/whatsapp/calling/ice-config';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    await callingConfig(ctx.accountId);
    const iceServers = callingIceServers(ctx.userId);
    return NextResponse.json(
      { iceServers },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
