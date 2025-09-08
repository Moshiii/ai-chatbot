import { NextResponse, type NextRequest } from 'next/server';
import { stackServerApp } from './lib/stack';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 });
  }

  // Allow Stack Auth API routes to pass through
  if (pathname.startsWith('/api/stack')) {
    return NextResponse.next();
  }

  // Allow Stack Auth handler routes (OAuth callbacks, etc.) to pass through
  if (pathname.startsWith('/handler')) {
    return NextResponse.next();
  }

  // Keep legacy auth routes for transition period
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Do not run auth redirects on API routes; let route handlers handle auth
  if (pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  let user = null;
  try {
    // Try to get the current Stack user (pass request so cookies are accessible in middleware)
    user = await stackServerApp.getUser({ tokenStore: request });
  } catch (error) {
    // User not authenticated or other error
    console.log('Stack auth check failed:', error);
  }

  // If no user, redirect to login for protected routes
  if (!user) {
    // Allow access to login page
    if (pathname === '/login') {
      return NextResponse.next();
    }

    // Redirect to login for other pages
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Redirect authenticated users away from login page
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/login',
    '/marketplace',
    '/profile',
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
