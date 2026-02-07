import { NextRequest, NextResponse } from 'next/server';
import { getTaskRuns } from '@/lib/runner';
import { getDb } from '@/lib/db';
import { requireLocalhost } from '@/lib/auth';

// GET /api/tasks/[id]/runs - Get all runs for a task
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireLocalhost(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const db = getDb();
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const runs = getTaskRuns(id);
    return NextResponse.json(runs);
  } catch (error) {
    console.error('Failed to fetch runs:', error);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}
