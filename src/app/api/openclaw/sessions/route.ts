import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import type { OpenClawSession } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/openclaw/sessions - List OpenClaw sessions
// NOTE: WebSocket client temporarily disabled; only DB queries work
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionType = searchParams.get('session_type');
    const status = searchParams.get('status');

    let sql = 'SELECT * FROM openclaw_sessions WHERE 1=1';
    const params: unknown[] = [];

    if (sessionType) {
      sql += ' AND session_type = ?';
      params.push(sessionType);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    const sessions = queryAll<OpenClawSession>(sql, params);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error('Failed to list OpenClaw sessions:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/openclaw/sessions - Create a new OpenClaw session
// NOTE: WebSocket client temporarily disabled
export async function POST() {
  return NextResponse.json(
    { error: 'OpenClaw WebSocket client temporarily disabled' },
    { status: 503 }
  );
}
