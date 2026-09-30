/**
 * Security headers on every response.
 *
 * Route-level authorisation lives in the handlers (middleware cannot reach the
 * database on the edge runtime), so this deliberately does only what it can do
 * reliably: headers, and a cheap redirect for unauthenticated page requests.
 */

import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/signup', '/verify-email', '/api/auth'];

/**
 * Brand artwork, listed exactly rather than by prefix.
 *
 * The signed-out pages carry the logo and the browser asks for the favicon
 * before any session exists, so without this the redirect below answers an
 * image request with an HTML login page — the mark simply fails to render on
 * the one screen where it is the whole of the content. Named files rather than
 * a `/logo` prefix: a prefix rule quietly widens itself the first time someone
 * adds a route that happens to start the same way.
 */
const PUBLIC_ASSETS = new Set([
  '/logo.png',
  '/logo-dark.png',
  '/logo-panel.png',
  '/logo-mark.png',
  '/logo-mark-dark.png',
  '/icon.png',
  '/apple-icon.png',
  '/favicon.ico',
]);

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  res.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Next's dev bundler (eval-source-map) ships every module inside eval(),
      // so without 'unsafe-eval' the dev server cannot hydrate: React never
      // attaches, and forms silently fall back to a native GET that puts the
      // password in the URL. Development only — in production this stays off,
      // and both should be replaced by a nonce before launch.
      process.env.NODE_ENV === 'development'
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname.startsWith(p)) || PUBLIC_ASSETS.has(pathname);
  const hasCookie = req.cookies.has('finmanai_session');

  if (!isPublic && !hasCookie && !pathname.startsWith('/_next')) {
    // API routes answer for themselves. Redirecting a JSON caller to an HTML
    // login page turns an authorisation failure into a 307 the client cannot
    // interpret; the handler's requireUser() returns a proper 401 instead.
    if (!pathname.startsWith('/api/')) {
      return NextResponse.redirect(new URL('/login', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
