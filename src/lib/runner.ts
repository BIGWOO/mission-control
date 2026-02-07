/**
 * Task Runner Engine
 * Spawns Claude Code CLI or Codex CLI processes and streams output via SSE
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { getDb } from './db';
import { broadcast } from './events';
import type { CliType, RunStatus, TaskRun, Task } from './types';

const MAX_CONCURRENT = 2;

// Track active processes
const activeProcesses = new Map<string, ChildProcess>();

// CLI paths (resolved once)
let claudePath = '';
let codexPath = '';

function getCliPath(cli: CliType): string {
  if (cli === 'claude') {
    if (claudePath === '') {
      try {
        const result = execSync('which claude', { encoding: 'utf-8' }).trim();
        claudePath = result || '/Users/bigwoo/.local/bin/claude';
      } catch {
        claudePath = '/Users/bigwoo/.local/bin/claude';
      }
    }
    return claudePath;
  } else {
    if (codexPath === '') {
      try {
        const result = execSync('which codex', { encoding: 'utf-8' }).trim();
        codexPath = result || '/usr/local/bin/codex';
      } catch {
        codexPath = '/usr/local/bin/codex';
      }
    }
    return codexPath;
  }
}

export function updateTaskStatus(taskId: string, status: string): void {
  const db = getDb();
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, taskId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined;
  if (task) {
    broadcast({ type: 'task_updated', payload: task });
  }
}

function updateRun(runId: string, fields: Partial<TaskRun>): void {
  const db = getDb();
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'id' || key === 'task_id' || key === 'created_at') continue;
    updates.push(`${key} = ?`);
    values.push(value ?? null);
  }

  if (updates.length > 0) {
    values.push(runId);
    db.prepare(`UPDATE task_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
}

function getRunningCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM task_runs WHERE status = 'running'").get() as { count: number };
  return row.count;
}

// Allowed project directories (whitelist). Paths must start with one of these prefixes.
const ALLOWED_PROJECT_DIRS = [
  '/Users/bigwoo/repos/',
  '/Users/bigwoo/.openclaw/',
  '/tmp/',
];

/** Thrown for client-side validation errors (should map to 4xx) */
export class RunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunValidationError';
  }
}

export interface StartRunOptions {
  cli_type: CliType;
  prompt: string;
  project_dir?: string;
}

export function startRun(taskId: string, options: StartRunOptions): TaskRun {
  // Validate project_dir
  if (options.project_dir) {
    const resolved = path.resolve(options.project_dir);
    if (!fs.existsSync(resolved)) {
      throw new RunValidationError('project_dir does not exist');
    }
    // Resolve symlinks to prevent escape from allowed directories
    const dir = fs.realpathSync(resolved);
    if (!ALLOWED_PROJECT_DIRS.some(prefix => dir.startsWith(prefix))) {
      throw new RunValidationError(`project_dir must be under an allowed directory: ${ALLOWED_PROJECT_DIRS.join(', ')}`);
    }
    if (!fs.statSync(dir).isDirectory()) {
      throw new RunValidationError('project_dir is not a directory');
    }
  }

  const db = getDb();
  const runId = randomUUID();
  const now = new Date().toISOString();

  // Atomic check + insert inside a transaction to prevent race conditions
  const insertRun = db.transaction(() => {
    // Check concurrency limit inside transaction (include pending + running)
    const row = db.prepare("SELECT COUNT(*) as count FROM task_runs WHERE status IN ('pending', 'running')").get() as { count: number };
    if (row.count >= MAX_CONCURRENT) {
      throw new RunValidationError(`Maximum concurrent runs (${MAX_CONCURRENT}) reached. Cancel a running task first.`);
    }

    // Check no active run for this task
    const activeRun = db.prepare(
      "SELECT id FROM task_runs WHERE task_id = ? AND status IN ('pending', 'running') LIMIT 1"
    ).get(taskId);
    if (activeRun) {
      throw new RunValidationError('Task already has an active run');
    }

    // Insert run record
    db.prepare(`
      INSERT INTO task_runs (id, task_id, cli_type, status, prompt, project_dir, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(runId, taskId, options.cli_type, options.prompt, options.project_dir || null, now);
  });

  insertRun();

  const cliPath = getCliPath(options.cli_type);

  // Build command args
  let args: string[];
  if (options.cli_type === 'claude') {
    args = ['-p', options.prompt, '--output-format', 'stream-json'];
  } else {
    args = ['exec', options.prompt];
  }

  const cwd = options.project_dir || process.cwd();

  // Spawn process
  const child = spawn(cliPath, args, {
    cwd,
    env: {
      ...process.env,
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcesses.set(runId, child);

  // Update status to running
  updateRun(runId, {
    status: 'running',
    pid: child.pid,
    started_at: new Date().toISOString(),
  } as Partial<TaskRun>);

  // Auto-update task status to in_progress
  updateTaskStatus(taskId, 'in_progress');

  broadcast({
    type: 'run_status_changed',
    payload: { runId, taskId, status: 'running' as RunStatus },
  });

  const MAX_OUTPUT_SIZE = 5 * 1024 * 1024; // 5MB
  let fullOutput = '';

  const handleData = (chunk: Buffer) => {
    const text = chunk.toString();
    fullOutput += text;
    if (fullOutput.length > MAX_OUTPUT_SIZE) {
      fullOutput = '... (truncated) ...\n' + fullOutput.slice(-MAX_OUTPUT_SIZE);
    }

    broadcast({
      type: 'run_output',
      payload: { runId, taskId, output: text },
    });
  };

  child.stdout?.on('data', handleData);
  child.stderr?.on('data', handleData);

  child.on('close', (code) => {
    activeProcesses.delete(runId);

    // Check if already cancelled (don't overwrite)
    const currentRun = db.prepare('SELECT status FROM task_runs WHERE id = ?').get(runId) as { status: string } | undefined;
    if (currentRun?.status === 'cancelled') return;

    const finalStatus: RunStatus = code === 0 ? 'completed' : 'failed';
    const completedAt = new Date().toISOString();

    updateRun(runId, {
      status: finalStatus,
      exit_code: code ?? undefined,
      output: fullOutput,
      completed_at: completedAt,
    } as Partial<TaskRun>);

    // Auto-update task status: completed → review, failed → testing
    if (finalStatus === 'completed') {
      updateTaskStatus(taskId, 'review');
    } else if (finalStatus === 'failed') {
      updateTaskStatus(taskId, 'testing');
    }

    broadcast({
      type: 'run_status_changed',
      payload: { runId, taskId, status: finalStatus, exit_code: code ?? undefined },
    });
  });

  child.on('error', (err) => {
    activeProcesses.delete(runId);

    updateRun(runId, {
      status: 'failed',
      error: err.message,
      output: fullOutput,
      completed_at: new Date().toISOString(),
    } as Partial<TaskRun>);

    // Auto-update task status to testing on failure
    updateTaskStatus(taskId, 'testing');

    broadcast({
      type: 'run_status_changed',
      payload: { runId, taskId, status: 'failed' as RunStatus, error: err.message },
    });
  });

  // Return the created run
  return db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as TaskRun;
}

export function cancelRun(runId: string): boolean {
  const child = activeProcesses.get(runId);
  if (child) {
    // Mark as cancelled in DB first
    updateRun(runId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    } as Partial<TaskRun>);

    // Kill process (close handler will check cancelled status and skip)
    child.kill('SIGTERM');
    setTimeout(() => {
      if (activeProcesses.has(runId)) {
        child.kill('SIGKILL');
        activeProcesses.delete(runId);
      }
    }, 5000);

    // Broadcast
    const db = getDb();
    const run = db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as TaskRun | undefined;
    if (run) {
      broadcast({
        type: 'run_status_changed',
        payload: { runId, taskId: run.task_id, status: 'cancelled' as RunStatus },
      });
    }

    return true;
  }

  // Process not in memory but might be in DB as running
  const db = getDb();
  const run = db.prepare("SELECT * FROM task_runs WHERE id = ? AND status = 'running'").get(runId) as TaskRun | undefined;
  if (run) {
    updateRun(runId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    } as Partial<TaskRun>);
    broadcast({
      type: 'run_status_changed',
      payload: { runId, taskId: run.task_id, status: 'cancelled' as RunStatus },
    });
    return true;
  }

  return false;
}

export function getRunStatus(runId: string): TaskRun | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as TaskRun) || null;
}

export function getTaskRuns(taskId: string): TaskRun[] {
  const db = getDb();
  return db.prepare('SELECT * FROM task_runs WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as TaskRun[];
}

export function getActiveRunForTask(taskId: string): TaskRun | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM task_runs WHERE task_id = ? AND status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1").get(taskId) as TaskRun) || null;
}
