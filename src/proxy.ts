import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIXES = ["/account", "/wallet", "/finance", "/become-a-seller", "/orders", "/seller", "/admin", "/call"];
const GUEST_ONLY_PREFIXES = [
  "/auth/sign-in",
  "/auth/sign-up",
  "/auth/forgot-password",
];

// NOTE on auth rate limiting.
//
// We intentionally do NOT rate-limit /auth/* here. Earlier revisions
// kept an in-memory bucket that counted every GET to /auth/sign-in
// (page navigation) as an "attempt", which caused the public sign-in
// page to surface a raw JSON 429 after a few page refreshes — even
// though the actual sign-in flow uses Supabase client-side and
// bypasses this middleware entirely. Real sign-in attempts are
// already rate-limited by Supabase Auth (returns 429 for too many
// sign-in attempts on the same email/IP), so adding a second layer
// here only causes false positives for normal browsing.
//
// If you ever need an edge-level rate limit again, put it on the
// server-action / route-handler that actually mutates auth state
// (e.g. /api/auth/sign-in), not on the page-render middleware.

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Not configured — pages render their own setup notice instead.
    return NextResponse.next({ request });
  }

  const { pathname, search } = request.nextUrl;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const target = request.nextUrl.clone();
    target.pathname = "/auth/sign-in";
    target.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(target);
  }

  if (user && matches(pathname, GUEST_ONLY_PREFIXES)) {
    const target = request.nextUrl.clone();
    target.pathname = "/account";
    target.search = "";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico).*)"],
};
