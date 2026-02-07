/**
 * Simple localhost-only authentication middleware
 * Mission Control only accepts requests from localhost
 *
 * Security layers:
 * 1. Next.js binds to localhost only (--hostname 127.0.0.1 in start script)
 * 2. Host header check as defense-in-depth
 * 3. Optional API key for additional protection
 */

import { NextRequest, NextResponse } from 'next/server';

const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

// Optional API key from environment for extra security
const API_KEY = process.env.MC_API_KEY || '';

/**
 * Check if request originates from localhost.
 * Returns null if allowed, or a 403 NextResponse if denied.
 *
 * Primary security: Next.js --hostname 127.0.0.1 prevents remote TCP connections.
 * This function is defense-in-depth against misconfiguration.
 */
export function requireLocalhost(request: NextRequest): NextResponse | null {
  // In development, always allow
  if (process.env.NODE_ENV === 'development') return null;

  // If API key is configured, require it (strongest auth)
  if (API_KEY) {
    const authHeader = request.headers.get('authorization');
    const providedKey = authHeader?.replace('Bearer ', '');
    if (providedKey !== API_KEY) {
      return NextResponse.json(
        { error: 'Forbidden: invalid API key' },
        { status: 403 }
      );
    }
    return null;
  }

  // Defense-in-depth: check host header
  // Note: Host header can be spoofed, but primary security is TCP bind to 127.0.0.1
  const host = request.headers.get('host') || '';
  const hostName = host.split(':')[0];

  if (!hostName || !LOCALHOST_HOSTS.has(hostName)) {
    return NextResponse.json(
      { error: 'Forbidden: only localhost access allowed' },
      { status: 403 }
    );
  }

  return null;
}
