import { NextResponse, type NextRequest } from "next/server";

/**
 * One origin, a strict content security policy, and no third-party scripts
 * anywhere. Keys are derived in the browser, so cross-site scripting is the
 * only catastrophic bug in this system (architecture §10).
 */
const ROUTES = new Set(["/", "/start", "/till", "/pay", "/staff"]);

export function proxy(request: NextRequest) {
  // Unrecognised paths resolve to the landing page: the usual cause is a truncated or mistyped link.
  const path = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  if (!ROUTES.has(path) && !path.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/", request.url), 307);
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const rpc = process.env.NEXT_PUBLIC_RPC_URL ?? "";
  const ws = process.env.NEXT_PUBLIC_WS_URL ?? "";
  const indexer = process.env.NEXT_PUBLIC_INDEXER_URL ?? "";
  const connect = ["'self'", rpc, ws, indexer, isDev ? "ws: http://127.0.0.1:* http://localhost:*" : ""].filter(Boolean).join(" ");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Style attributes need 'unsafe-inline'; scripts stay nonce-only, which is where XSS would matter.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|.*\\.(?:png|jpg|svg|webp|mp4|webm|woff2?)$).*)" }],
};
