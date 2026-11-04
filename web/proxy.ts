import { NextResponse, type NextRequest } from "next/server";

// The admin pages (/logs and /login) live on their own host when ADMIN_HOST is set, for example admin.kinbeat.com.
// On the main host they redirect there; on the admin host every other path goes to /logs. Without ADMIN_HOST nothing changes.
export function proxy(request: NextRequest) {
  const adminHost = process.env.ADMIN_HOST;
  if (!adminHost) return NextResponse.next();
  const host = request.headers.get("host") ?? "";
  const { pathname, search } = request.nextUrl;
  // Any other name that reaches the live app (www, kinbeat.org, kinbeat.co.uk, kinbeat.store) goes to the main site.
  // MAIN_HOST is the public name, for example kinbeat.com; the service's own run.app name is left alone for checks.
  const mainHost = process.env.MAIN_HOST;
  if (mainHost && host !== mainHost && host !== adminHost && !host.endsWith(".run.app")) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, `https://${mainHost}`), 308);
  }
  const adminPage = pathname === "/logs" || pathname === "/login" || pathname.startsWith("/login/");
  if (host === adminHost) return adminPage ? NextResponse.next() : NextResponse.redirect(new URL("/logs", `https://${adminHost}`));
  if (adminPage) return NextResponse.redirect(new URL(`${pathname}${search}`, `https://${adminHost}`));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
