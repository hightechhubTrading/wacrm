import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocaleId, LOCALE_COOKIE } from "@/lib/locales";

/**
 * POST /api/locale
 *
 * Body: { locale }
 * Sets the wacrm.locale cookie src/i18n/request.ts reads. No auth
 * gate: this is a self-service, per-device preference with no
 * cross-account effect — worst case, an attacker flips a visitor's
 * UI language cookie, which is why we also reject cross-site requests
 * below even though the blast radius is already low.
 */
export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site request" }, { status: 400 });
  }

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
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.json({ locale });
}
