import { NextResponse } from 'next/server';

// Force dynamic - don't try to connect during build
export const dynamic = 'force-dynamic';

// GET /api/openclaw/status - Check OpenClaw connection status
// NOTE: WebSocket client temporarily disabled due to ws module bundling issue
// TODO: Fix ws externals in next.config.mjs and re-enable
export async function GET() {
  return NextResponse.json({
    connected: false,
    error: 'OpenClaw WebSocket client temporarily disabled',
    gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789',
  });
}
