import { NextResponse, type NextRequest } from "next/server";
import { setSession } from "@/lib/session";
import { claimInvites } from "@/lib/team";

/**
 * Magic-link landing page. Set the Supabase "Magic Link" email template's link to:
 *   {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
 */
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const fail = NextResponse.redirect(new URL("/login?error=link", req.url));
  if (!tokenHash || !process.env.SUPABASE_URL) return fail;
  const { authClient } = await import("@/lib/db/supabase");
  const { data, error } = await authClient().auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (error || !data.user) return fail;
  await claimInvites(data.user.id, data.user.email ?? "");
  await setSession({ kind: "manager", userId: data.user.id, email: data.user.email ?? "" });
  return NextResponse.redirect(new URL("/stores", req.url));
}
