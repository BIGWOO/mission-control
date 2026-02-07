'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Clock, Terminal, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { TaskRun, CliType, RunStatus } from '@/lib/types';

interface RunnerTabProps {
  taskId: string;
  taskDescription?: string;
  workspaceId?: string;
}

const MAX_DISPLAY_LINES = 500;

function StatusBadge({ status }: { status: RunStatus }) {
  const colors: Record<RunStatus, string> = {
    pending: 'text-yellow-400',
    running: 'text-blue-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
    cancelled: 'text-gray-400',
  };
  const icons: Record<RunStatus, React.ReactNode> = {
    pending: <Clock className="w-3 h-3" />,
    running: <Terminal className="w-3 h-3 animate-pulse" />,
    completed: <CheckCircle className="w-3 h-3" />,
    failed: <XCircle className="w-3 h-3" />,
    cancelled: <AlertCircle className="w-3 h-3" />,
  };

  return (
    <span className={`flex items-center gap-1 text-xs ${colors[status]}`}>
      {icons[status]}
      {status.toUpperCase()}
    </span>
  );
}

export function RunnerTab({ taskId, taskDescription, workspaceId }: RunnerTabProps) {
  const { t } = useTranslation();
  const [cliType, setCliType] = useState<CliType>('claude');
  const [projectDir, setProjectDir] = useState('');
  const [prompt, setPrompt] = useState(taskDescription || '');
  const [isStarting, setIsStarting] = useState(false);
  const [activeRun, setActiveRun] = useState<TaskRun | null>(null);
  const [liveOutput, setLiveOutput] = useState('');
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [selectedRunOutput, setSelectedRunOutput] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load workspace defaults
  useEffect(() => {
    if (workspaceId) {
      fetch(`/api/workspaces/${workspaceId}`)
        .then(r => r.json())
        .then(ws => {
          if (ws.default_cli) setCliType(ws.default_cli);
          if (ws.default_project_dir) setProjectDir(ws.default_project_dir);
        })
        .catch(() => {});
    }
  }, [workspaceId]);

  // Load runs
  const loadRuns = useCallback(() => {
    fetch(`/api/tasks/${taskId}/runs`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setRuns(data);
          const active = data.find((r: TaskRun) => r.status === 'running' || r.status === 'pending');
          if (active) setActiveRun(active);
        }
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // SSE for live output
  useEffect(() => {
    if (!activeRun) return;

    const es = new EventSource('/api/events/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const sseEvent = JSON.parse(event.data);
        if (sseEvent.type === 'run_output' && sseEvent.payload?.runId === activeRun.id) {
          setLiveOutput(prev => {
            const updated = prev + sseEvent.payload.output;
            // Keep only last MAX_DISPLAY_LINES lines
            const lines = updated.split('\n');
            if (lines.length > MAX_DISPLAY_LINES) {
              return lines.slice(-MAX_DISPLAY_LINES).join('\n');
            }
            return updated;
          });
        }
        if (sseEvent.type === 'run_status_changed' && sseEvent.payload?.runId === activeRun.id) {
          const newStatus = sseEvent.payload.status;
          if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
            setActiveRun(null);
            loadRuns();
          }
        }
      } catch {}
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [activeRun, loadRuns]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [liveOutput]);

  const handleStart = async () => {
    if (!prompt.trim()) return;
    setIsStarting(true);
    setLiveOutput('');

    try {
      const res = await fetch(`/api/tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli_type: cliType, prompt, project_dir: projectDir || undefined }),
      });

      if (res.ok) {
        const run = await res.json();
        setActiveRun(run);
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to start run');
      }
    } catch (e) {
      alert('Failed to start run');
    } finally {
      setIsStarting(false);
    }
  };

  const handleCancel = async () => {
    try {
      await fetch(`/api/tasks/${taskId}/run`, { method: 'DELETE' });
      setActiveRun(null);
      loadRuns();
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      {!activeRun && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-mc-text-secondary">{t('runner.cliType')}</label>
              <select
                value={cliType}
                onChange={(e) => setCliType(e.target.value as CliType)}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
              >
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-mc-text-secondary">{t('runner.projectDir')}</label>
              <input
                type="text"
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
                className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
                placeholder="/Users/bigwoo/repos/..."
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-mc-text-secondary">{t('runner.prompt')}</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              className="w-full bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm resize-y min-h-[200px]"
              placeholder={t('runner.promptPlaceholder')}
            />
          </div>

          <button
            onClick={handleStart}
            disabled={isStarting || !prompt.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {isStarting ? t('runner.starting') : t('runner.start')}
          </button>
        </div>
      )}

      {/* Active run output */}
      {activeRun && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusBadge status={activeRun.status as RunStatus} />
              <span className="text-xs text-mc-text-secondary">
                {activeRun.cli_type === 'claude' ? 'Claude Code' : 'Codex'} • PID: {activeRun.pid || '…'}
              </span>
            </div>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-3 py-1 text-xs text-mc-accent-red hover:bg-mc-accent-red/10 rounded"
            >
              <Square className="w-3 h-3" />
              {t('runner.cancel')}
            </button>
          </div>

          <pre
            ref={outputRef}
            className="bg-black text-green-400 font-mono text-xs p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap"
          >
            {liveOutput || t('runner.waitingOutput')}
          </pre>
        </div>
      )}

      {/* History */}
      {runs.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 text-mc-text-secondary">{t('runner.history')}</h3>
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between p-2 bg-mc-bg rounded border border-mc-border text-xs cursor-pointer hover:border-mc-accent/50"
                onClick={() => setSelectedRunOutput(selectedRunOutput === run.id ? null : run.id)}
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={run.status} />
                  <span className="text-mc-text-secondary">
                    {run.cli_type === 'claude' ? 'Claude' : 'Codex'}
                  </span>
                  <span className="text-mc-text-secondary truncate max-w-48">
                    {run.prompt.substring(0, 60)}...
                  </span>
                </div>
                <span className="text-mc-text-secondary">
                  {run.created_at ? new Date(run.created_at).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>

          {/* Expanded output for selected run */}
          {selectedRunOutput && (() => {
            const run = runs.find(r => r.id === selectedRunOutput);
            if (!run?.output) return null;
            const lines = run.output.split('\n');
            const display = lines.length > MAX_DISPLAY_LINES
              ? lines.slice(-MAX_DISPLAY_LINES).join('\n')
              : run.output;
            return (
              <pre className="mt-2 bg-black text-green-400 font-mono text-xs p-3 rounded max-h-48 overflow-y-auto whitespace-pre-wrap">
                {display}
              </pre>
            );
          })()}
        </div>
      )}
    </div>
  );
}
