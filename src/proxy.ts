// src/proxy.ts
// Next.js 16 Proxy Middleware — protects all (app) routes and handles Supabase auth sessions
// Hardened for Vercel Edge deployments with defensive fallback guards

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabasePublicKey } from '@/lib/config';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = getSupabasePublicKey();

  // Defensive check for Vercel deployment: if env vars are not set, allow request to render login
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;

    // Auth routes — redirect to /scan if logged in
    if (pathname.startsWith('/login')) {
      if (user) {
        return NextResponse.redirect(new URL('/scan', request.url));
      }
      return supabaseResponse;
    }

    // API routes return JSON 401/403 responses from their handlers; never redirect them to HTML.
    if (pathname.startsWith('/api/')) {
      return supabaseResponse;
    }

    // Protected routes — redirect to /login if not authenticated
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(url);
    }
  } catch (err) {
    console.error('[Proxy Error]', err);
    return supabaseResponse;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
