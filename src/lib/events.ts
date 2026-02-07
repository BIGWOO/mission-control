/**
 * Server-Sent Events (SSE) broadcaster for real-time updates
 * Manages client connections and broadcasts events to all listeners
 */

import type { SSEEvent, RunStatus } from './types';
import { notifyDiscord } from './discord-notify';

// Store active SSE client connections
const clients = new Set<ReadableStreamDefaultController>();

/**
 * Register a new SSE client connection
 */
export function registerClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller);
}

/**
 * Unregister an SSE client connection
 */
export function unregisterClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
}

/**
 * Broadcast an event to all connected SSE clients
 */
export function broadcast(event: SSEEvent): void {
  const encoder = new TextEncoder();
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoded = encoder.encode(data);

  // Send to all connected clients
  const clientsArray = Array.from(clients);
  for (const client of clientsArray) {
    try {
      client.enqueue(encoded);
    } catch (error) {
      // Client disconnected, remove it
      console.error('Failed to send SSE event to client:', error);
      clients.delete(client);
    }
  }

  console.log(`[SSE] Broadcast ${event.type} to ${clients.size} client(s)`);

  // Fire-and-forget Discord notification
  triggerDiscordNotification(event).catch(() => {});
}

/**
 * Map SSE events to Discord notification events
 */
async function triggerDiscordNotification(event: SSEEvent): Promise<void> {
  const { type, payload } = event;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any;

  let workspaceId: string | undefined;
  let discordEventType: string | undefined;

  switch (type) {
    case 'task_created':
      workspaceId = p.workspace_id;
      discordEventType = 'task_created';
      break;
    case 'task_updated':
      workspaceId = p.workspace_id;
      // Only notify when status actually changed (previous_status must differ)
      if (p.status && p.previous_status && p.status !== p.previous_status) {
        discordEventType = 'task_status_changed';
      }
      break;
    case 'run_status_changed': {
      workspaceId = p.workspaceId;
      const status = p.status as RunStatus;
      if (status === 'running' || status === 'launched') discordEventType = 'run_started';
      else if (status === 'completed') discordEventType = 'run_completed';
      else if (status === 'failed') discordEventType = 'run_failed';
      // Try to get workspaceId from task if not in payload
      if (!workspaceId && p.taskId) {
        try {
          const { getDb } = await import('./db');
          const task = getDb().prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(p.taskId) as { workspace_id: string } | undefined;
          workspaceId = task?.workspace_id;
        } catch { /* ignore */ }
      }
      break;
    }
    case 'deliverable_added': {
      discordEventType = 'deliverable_added';
      // Get workspaceId from task
      if (p.task_id) {
        try {
          const { getDb } = await import('./db');
          const task = getDb().prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(p.task_id) as { workspace_id: string } | undefined;
          workspaceId = task?.workspace_id;
        } catch { /* ignore */ }
      }
      break;
    }
  }

  if (workspaceId && discordEventType) {
    await notifyDiscord(workspaceId, discordEventType, p);
  }
}

/**
 * Get the number of active SSE connections
 */
export function getActiveConnectionCount(): number {
  return clients.size;
}
