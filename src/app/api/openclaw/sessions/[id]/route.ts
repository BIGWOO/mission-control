import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/openclaw/sessions/[id] - Get session details
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // List sessions and find the one with matching ID
    const sessions = await client.listSessions();
    const session = sessions.find((s) => s.id === id);

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Failed to get OpenClaw session:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/openclaw/sessions/[id] - Send a message to the session
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json(
        { error: 'content is required' },
        { status: 400 }
      );
    }

    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // Prefix message with [Mission Control] so Charlie knows the source
    const prefixedContent = `[Mission Control] ${content}`;
    await client.sendMessage(id, prefixedContent);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to send message to OpenClaw session:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH /api/openclaw/sessions/[id] - Update session status (for completing sub-agents)
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, ended_at } = body;

    const db = getDb();

    // Find session by openclaw_session_id
    const session = db.prepare('SELECT * FROM openclaw_sessions WHERE openclaw_session_id = ?').get(id) as any;

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found in database' },
        { status: 404 }
      );
    }

    // Update session
    const updates: string[] = [];
    const values: unknown[] = [];

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }

    if (ended_at !== undefined) {
      updates.push('ended_at = ?');
      values.push(ended_at);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(session.id);

    db.prepare(`UPDATE openclaw_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updatedSession = db.prepare('SELECT * FROM openclaw_sessions WHERE id = ?').get(session.id);

    // Broadcast session completion if status changed to completed
    if (status === 'completed' && session.task_id) {
      broadcast({
        type: 'agent_completed',
        payload: {
          taskId: session.task_id,
          sessionId: id,
        },
      });
    }

    return NextResponse.json(updatedSession);
  } catch (error) {
    console.error('Failed to update OpenClaw session:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
