/**
 * Task Runner Engine
 * Launches Claude Code CLI or Codex CLI in iTerm2 tabs for interactive use
 */

import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { getDb } from './db';
import { broadcast } from './events';
import type { CliType, RunStatus, TaskRun, Task } from './types';

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

function escapeAppleScript(str: string): string {
  // Escape backslashes first, then double quotes
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function copyToClipboard(text: string): void {
  try {
    execSync('pbcopy', { input: text, encoding: 'utf-8' });
  } catch {
    // Silently fail if pbcopy is unavailable
  }
}

function launchInITerm2(taskId: string, options: StartRunOptions): TaskRun {
  const db = getDb();
  const runId = randomUUID();
  const now = new Date().toISOString();

  // Validate project_dir
  if (options.project_dir) {
    const resolved = path.resolve(options.project_dir);
    if (!fs.existsSync(resolved)) {
      throw new RunValidationError('project_dir does not exist');
    }
    const dir = fs.realpathSync(resolved);
    if (!ALLOWED_PROJECT_DIRS.some(prefix => dir.startsWith(prefix))) {
      throw new RunValidationError(`project_dir must be under an allowed directory: ${ALLOWED_PROJECT_DIRS.join(', ')}`);
    }
    if (!fs.statSync(dir).isDirectory()) {
      throw new RunValidationError('project_dir is not a directory');
    }
  }

  // Atomic check + insert inside a transaction
  const insertRun = db.transaction(() => {
    // Check no active run for this task
    const activeRun = db.prepare(
      "SELECT id FROM task_runs WHERE task_id = ? AND status IN ('pending', 'running', 'launched') LIMIT 1"
    ).get(taskId);
    if (activeRun) {
      throw new RunValidationError('Task already has an active run');
    }

    // Insert run record as launched
    db.prepare(`
      INSERT INTO task_runs (id, task_id, cli_type, status, prompt, project_dir, started_at, created_at)
      VALUES (?, ?, ?, 'launched', ?, ?, ?, ?)
    `).run(runId, taskId, options.cli_type, options.prompt, options.project_dir || null, now, now);
  });

  insertRun();

  // Build the command
  const cliCommand = options.cli_type === 'claude' ? 'claude' : 'codex';
  const projectDir = options.project_dir || '/Users/bigwoo/repos';
  const tabName = escapeAppleScript(`MC: ${options.prompt.substring(0, 50)}`);

  // Copy prompt to clipboard if provided
  if (options.prompt) {
    copyToClipboard(options.prompt);
  }

  // Build AppleScript
  const script = `
tell application "iTerm2"
  activate
  tell current window
    create tab with default profile
    tell current session
      set name to "${tabName}"
      write text "cd ${escapeAppleScript(shellEscape(projectDir))} && ${cliCommand}"
    end tell
  end tell
end tell
`;

  try {
    // Use a temp file approach to avoid shell escaping issues
    const tmpFile = `/tmp/mc-iterm-${runId}.scpt`;
    fs.writeFileSync(tmpFile, script, 'utf-8');
    try {
      execSync(`osascript ${tmpFile}`, { timeout: 10000 });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  } catch (err) {
    // Update run as failed if AppleScript fails
    updateRun(runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Failed to launch iTerm2',
      completed_at: new Date().toISOString(),
    } as Partial<TaskRun>);

    broadcast({
      type: 'run_status_changed',
      payload: { runId, taskId, status: 'failed' as RunStatus, error: 'Failed to launch iTerm2' },
    });

    // Re-throw so the API route returns 500
    throw new Error(err instanceof Error ? err.message : 'Failed to launch iTerm2');
  }

  // Auto-update task status to in_progress
  updateTaskStatus(taskId, 'in_progress');

  broadcast({
    type: 'run_status_changed',
    payload: { runId, taskId, status: 'launched' as RunStatus },
  });

  return db.prepare('SELECT * FROM task_runs WHERE id = ?').get(runId) as TaskRun;
}

export interface StartRunOptions {
  cli_type: CliType;
  prompt: string;
  project_dir?: string;
}

export function startRun(taskId: string, options: StartRunOptions): TaskRun {
  return launchInITerm2(taskId, options);
}

export function cancelRun(runId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const run = db.prepare("SELECT * FROM task_runs WHERE id = ? AND status IN ('running', 'launched', 'pending')").get(runId) as TaskRun | undefined;
    if (!run) return false;

    db.prepare("UPDATE task_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('running', 'launched', 'pending')").run(new Date().toISOString(), runId);

    broadcast({
      type: 'run_status_changed',
      payload: { runId, taskId: run.task_id, status: 'cancelled' as RunStatus },
    });

    return true;
  })();
}

export function markRunComplete(runId: string): boolean {
  const db = getDb();
  const result = db.transaction(() => {
    const run = db.prepare("SELECT * FROM task_runs WHERE id = ? AND status = 'launched'").get(runId) as TaskRun | undefined;
    if (!run) return null;

    db.prepare("UPDATE task_runs SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'launched'").run(new Date().toISOString(), runId);

    return run;
  })();

  if (!result) return false;

  updateTaskStatus(result.task_id, 'review');

  broadcast({
    type: 'run_status_changed',
    payload: { runId, taskId: result.task_id, status: 'completed' as RunStatus },
  });

  return true;
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
  return (db.prepare("SELECT * FROM task_runs WHERE task_id = ? AND status IN ('pending', 'running', 'launched') ORDER BY created_at DESC LIMIT 1").get(taskId) as TaskRun) || null;
}
