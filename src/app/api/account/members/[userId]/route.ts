// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role, WAHA session name, and/or
//            phone number. Admin+.
//   DELETE — remove a member.                                 Admin+.
//
// Both delegate to SECURITY DEFINER RPCs:
//   - set_member_role(p_user_id, p_new_role)                          (018)
//   - set_member_waha_channel(p_user_id, p_session_name, p_phone,
//       p_new_webhook_secret)                                          (053)
//   - remove_account_member(p_user_id)                                (018)
//
// The RPCs do the *real* authorisation work — caller must be
// admin+, target must be in caller's account (set_member_role also
// blocks owner promotion/demotion and self-targeting; the WAHA
// channel RPC intentionally does NOT block self-targeting — an
// admin who is also a working sales agent can set their own). The
// TS layer here only forwards the call and maps Postgres SQLSTATEs
// back to HTTP statuses.
//
// Webhook secret: the first time a session is connected (i.e. the
// row has no waha_webhook_secret yet), this route generates a
// random secret, encrypts it, and passes the ciphertext to the RPC
// to store. The plaintext secret is embedded in a webhook URL and
// returned exactly once in the PATCH response — it is never stored
// or returned again after that.
// ============================================================

import crypto from "crypto";

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { encrypt } from "@/lib/whatsapp/encryption";

// Map known SQLSTATEs from the RPCs (see migration 018) onto HTTP
// statuses. The `error.code` field is the SQLSTATE; the `message`
// is the human-readable RAISE message we put in the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; waha_session_name?: unknown; phone?: unknown }
      | null;

    const roleProvided = body !== null && "role" in body;
    const wahaProvided = body !== null && "waha_session_name" in body;
    const phoneProvided = body !== null && "phone" in body;

    if (!roleProvided && !wahaProvided && !phoneProvided) {
      return NextResponse.json(
        { error: "Provide 'role', 'waha_session_name', and/or 'phone'" },
        { status: 400 },
      );
    }

    if (roleProvided) {
      const role = body!.role;

      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }

      // The RPC blocks promotion to / demotion from owner, but
      // surface the friendlier 400 before crossing the wire too.
      if (role === "owner") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/account/transfer-ownership to promote a member to owner",
          },
          { status: 400 },
        );
      }

      const { error } = await ctx.supabase.rpc("set_member_role", {
        p_user_id: userId,
        p_new_role: role,
      });

      if (error) return rpcErrorToResponse(error);
    }

    let webhookUrlForResponse: string | null = null;

    if (wahaProvided || phoneProvided) {
      let sessionRaw: unknown;
      let phoneRaw: unknown;

      if (wahaProvided) {
        sessionRaw = body!.waha_session_name;
        if (sessionRaw !== null && typeof sessionRaw !== "string") {
          return NextResponse.json(
            { error: "'waha_session_name' must be a string or null" },
            { status: 400 },
          );
        }
      }
      if (phoneProvided) {
        phoneRaw = body!.phone;
        if (phoneRaw !== null && typeof phoneRaw !== "string") {
          return NextResponse.json(
            { error: "'phone' must be a string or null" },
            { status: 400 },
          );
        }
      }

      const { data: current, error: currentError } = await ctx.supabase
        .from("profiles")
        .select("waha_session_name, phone, waha_webhook_secret")
        .eq("user_id", userId)
        .maybeSingle();

      if (currentError || !current) {
        return NextResponse.json({ error: "Target user not found" }, { status: 404 });
      }

      const finalSession = wahaProvided
        ? typeof sessionRaw === "string"
          ? sessionRaw.trim().slice(0, 100)
          : ""
        : (current.waha_session_name ?? "");
      const finalPhone = phoneProvided
        ? typeof phoneRaw === "string"
          ? phoneRaw.trim().slice(0, 32)
          : ""
        : (current.phone ?? "");

      let newSecretPlain: string | null = null;
      let newSecretEncrypted: string | null = null;
      if (finalSession && !current.waha_webhook_secret) {
        newSecretPlain = crypto.randomBytes(24).toString("hex");
        newSecretEncrypted = encrypt(newSecretPlain);
      }

      const { error } = await ctx.supabase.rpc("set_member_waha_channel", {
        p_user_id: userId,
        p_session_name: finalSession,
        p_phone: finalPhone,
        p_new_webhook_secret: newSecretEncrypted,
      });

      if (error) return rpcErrorToResponse(error);

      if (newSecretPlain && finalSession) {
        const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ?? "";
        webhookUrlForResponse = `${base}/api/waha/webhook/${ctx.account.id}/${encodeURIComponent(finalSession)}?secret=${newSecretPlain}`;
      }
    }

    return NextResponse.json({
      ok: true,
      ...(webhookUrlForResponse ? { webhook_url: webhookUrlForResponse } : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
