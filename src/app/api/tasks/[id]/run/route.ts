import { NextRequest, NextResponse } from 'next/server';
import { startRun, cancelRun, getActiveRunForTask, RunValidationError } from '@/lib/runner';
import { getDb } from '@/lib/db';
import { requireLocalhost } from '@/lib/auth';

// POST /api/tasks/[id]/run - Start a run
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth: localhost only
  const authError = requireLocalhost(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const body = await request.json();
    const { cli_type, prompt, project_dir } = body;

    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }
    if (cli_type && !['claude', 'codex'].includes(cli_type)) {
      return NextResponse.json({ error: 'cli_type must be claude or codex' }, { status: 400 });
    }

    // Check task exists
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    // Check no active run
    const activeRun = getActiveRunForTask(id);
    if (activeRun) {
      return NextResponse.json({ error: 'Task already has an active run', activeRun }, { status: 409 });
    }

    const run = startRun(id, {
      cli_type: cli_type || 'claude',
      prompt,
      project_dir,
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start run';
    console.error('Failed to start run:', error);

    if (error instanceof RunValidationError) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/tasks/[id]/run - Cancel active run
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireLocalhost(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    const activeRun = getActiveRunForTask(id);
    if (!activeRun) {
      return NextResponse.json({ error: 'No active run for this task' }, { status: 404 });
    }

    const cancelled = cancelRun(activeRun.id);
    if (cancelled) {
      return NextResponse.json({ success: true, runId: activeRun.id });
    }
    return NextResponse.json({ error: 'Failed to cancel run' }, { status: 500 });
  } catch (error) {
    console.error('Failed to cancel run:', error);
    return NextResponse.json({ error: 'Failed to cancel run' }, { status: 500 });
  }
}
