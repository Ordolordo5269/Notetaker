import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/sessions";

// Optimistic redirect only: real session validation happens in every page
// and API route (data-access layer), never in the proxy.
const PUBLIC_PATHS = ["/login", "/signup", "/privacy", "/offline"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|fonts|worklets|icons|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|ico|webp|woff2?|ttf|js)$).*)",
  ],
};
