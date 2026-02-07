'use client';

import { useState, useEffect, useCallback } from 'react';
import { Play, Clock, Terminal, CheckCircle, XCircle, AlertCircle, ExternalLink, Copy, Check } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { TaskRun, CliType, RunStatus } from '@/lib/types';

interface RunnerTabProps {
  taskId: string;
  taskDescription?: string;
  workspaceId?: string;
}

function StatusBadge({ status }: { status: RunStatus }) {
  const colors: Record<RunStatus, string> = {
    pending: 'text-yellow-400',
    running: 'text-blue-400',
    launched: 'text-purple-400',
    completed: 'text-green-400',
    failed: 'text-red-400',
    cancelled: 'text-gray-400',
  };
  const icons: Record<RunStatus, React.ReactNode> = {
    pending: <Clock className="w-3 h-3" />,
    running: <Terminal className="w-3 h-3 animate-pulse" />,
    launched: <ExternalLink className="w-3 h-3" />,
    completed: <CheckCircle className="w-3 h-3" />,
    failed: <XCircle className="w-3 h-3" />,
    cancelled: <AlertCircle className="w-3 h-3" />,
  };

  return (
    <span className={`flex items-center gap-1 text-xs ${colors[status]}`}>
      {icons[status]}
      {status === 'launched' ? 'iTerm2' : status.toUpperCase()}
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
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [promptCopied, setPromptCopied] = useState(false);

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
          const active = data.find((r: TaskRun) => r.status === 'running' || r.status === 'pending' || r.status === 'launched');
          setActiveRun(active || null);
        }
      })
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Listen for SSE status changes
  useEffect(() => {
    if (!activeRun) return;

    const es = new EventSource('/api/events/stream');

    es.onmessage = (event) => {
      try {
        const sseEvent = JSON.parse(event.data);
        if (sseEvent.type === 'run_status_changed' && sseEvent.payload?.runId === activeRun.id) {
          const newStatus = sseEvent.payload.status;
          if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
            setActiveRun(null);
            loadRuns();
          }
        }
      } catch {}
    };

    return () => { es.close(); };
  }, [activeRun, loadRuns]);

  const handleStart = async () => {
    if (!prompt.trim()) return;
    setIsStarting(true);
    setPromptCopied(false);

    try {
      const res = await fetch(`/api/tasks/${taskId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli_type: cliType, prompt, project_dir: projectDir || undefined }),
      });

      if (res.ok) {
        const run = await res.json();
        if (run.status === 'failed') {
          alert(run.error || 'Failed to launch');
          loadRuns();
        } else {
          setActiveRun(run);
          if (run.status === 'launched') {
            setPromptCopied(true);
          }
        }
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to start run');
      }
    } catch {
      alert('Failed to start run');
    } finally {
      setIsStarting(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!activeRun) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}/run`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      if (res.ok) {
        setActiveRun(null);
        loadRuns();
      }
    } catch {}
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
            <p className="text-xs text-mc-text-secondary mb-1 opacity-70">
              {t('runner.promptHint')}
            </p>
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

      {/* Active launched run */}
      {activeRun && activeRun.status === 'launched' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={activeRun.status} />
            <span className="text-xs text-mc-text-secondary">
              {activeRun.cli_type === 'claude' ? 'Claude Code' : 'Codex'}
            </span>
          </div>

          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 space-y-2">
            <p className="text-sm text-purple-300 font-medium">
              {t('runner.launched')}
            </p>
            <p className="text-xs text-mc-text-secondary">
              {t('runner.launchedHint')}
            </p>
            {promptCopied && (
              <p className="text-xs text-green-400 flex items-center gap-1">
                <Copy className="w-3 h-3" />
                {t('runner.promptCopied')}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleMarkComplete}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
            >
              <Check className="w-3 h-3" />
              {t('runner.markComplete')}
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-mc-accent-red hover:bg-mc-accent-red/10 rounded border border-mc-accent-red/30"
            >
              {t('runner.cancel')}
            </button>
          </div>
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
                className="flex items-center justify-between p-2 bg-mc-bg rounded border border-mc-border text-xs"
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
        </div>
      )}
    </div>
  );
}
