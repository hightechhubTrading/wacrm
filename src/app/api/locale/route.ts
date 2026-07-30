import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocaleId, LOCALE_COOKIE } from "@/lib/locales";

/**
 * POST /api/locale
 *
 * Body: { locale }
 * Sets the wacrm.locale cookie src/i18n/request.ts reads. No auth
 * gate — language is a self-service, per-device preference usable
 * even signed out (e.g. on /login), same reasoning as appearance.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const locale = body && typeof body.locale === "string" ? body.locale : "";

  if (!isLocaleId(locale)) {
    return NextResponse.json({ error: "Unknown locale" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return NextResponse.json({ locale });
}
