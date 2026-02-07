/**
 * Discord Notification Service
 * Sends embed messages via Discord webhooks
 */

import { getDb } from './db';
import type { DiscordEventType, NotificationSetting } from './types';

interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: EmbedField[];
  timestamp?: string;
}

// Embed colors per event type
const EVENT_COLORS: Record<DiscordEventType, number> = {
  task_created: 0x3498db,       // blue
  task_status_changed: 0xf39c12, // yellow
  run_started: 0x3498db,        // blue
  run_completed: 0x2ecc71,      // green
  run_failed: 0xe74c3c,         // red
  deliverable_added: 0x2ecc71,  // green
};

const EVENT_TITLES: Record<DiscordEventType, string> = {
  task_created: '📋 Task Created',
  task_status_changed: '🔄 Task Status Changed',
  run_started: '▶️ Run Started',
  run_completed: '✅ Run Completed',
  run_failed: '❌ Run Failed',
  deliverable_added: '📦 Deliverable Added',
};

function isNotificationEnabled(workspaceId: string, eventType: string): boolean {
  try {
    const db = getDb();
    const setting = db.prepare(
      'SELECT enabled FROM notification_settings WHERE workspace_id = ? AND event_type = ?'
    ).get(workspaceId, eventType) as { enabled: number } | undefined;
    // Default to enabled if no setting exists
    return setting ? setting.enabled === 1 : true;
  } catch {
    return true;
  }
}

function getWebhookUrl(workspaceId: string): string | null {
  // First check for workspace-specific webhook from discord_channels
  try {
    const db = getDb();
    const channel = db.prepare(
      "SELECT webhook_url FROM discord_channels WHERE workspace_id = ? AND channel_type IN ('notification', 'both') AND webhook_url IS NOT NULL LIMIT 1"
    ).get(workspaceId) as { webhook_url: string } | undefined;
    if (channel?.webhook_url) return channel.webhook_url;
  } catch {
    // fall through
  }
  // Fallback to global env var
  return process.env.DISCORD_WEBHOOK_URL || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEmbed(eventType: DiscordEventType, payload: any): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: EVENT_TITLES[eventType] || eventType,
    color: EVENT_COLORS[eventType] || 0x95a5a6,
    timestamp: new Date().toISOString(),
    fields: [],
  };

  switch (eventType) {
    case 'task_created':
      embed.description = payload.title || 'New task created';
      if (payload.description) {
        embed.fields!.push({ name: 'Description', value: payload.description.slice(0, 200) });
      }
      if (payload.priority) {
        embed.fields!.push({ name: 'Priority', value: payload.priority, inline: true });
      }
      break;
    case 'task_status_changed':
      embed.description = payload.title || 'Task status updated';
      if (payload.status) {
        embed.fields!.push({ name: 'Status', value: payload.status, inline: true });
      }
      break;
    case 'run_started':
      embed.description = `Run started for task`;
      if (payload.taskId) {
        embed.fields!.push({ name: 'Task ID', value: payload.taskId, inline: true });
      }
      if (payload.cli_type) {
        embed.fields!.push({ name: 'CLI', value: payload.cli_type, inline: true });
      }
      break;
    case 'run_completed':
      embed.description = `Run completed successfully`;
      if (payload.taskId) {
        embed.fields!.push({ name: 'Task ID', value: payload.taskId, inline: true });
      }
      break;
    case 'run_failed':
      embed.description = `Run failed`;
      if (payload.taskId) {
        embed.fields!.push({ name: 'Task ID', value: payload.taskId, inline: true });
      }
      if (payload.error) {
        embed.fields!.push({ name: 'Error', value: String(payload.error).slice(0, 200) });
      }
      break;
    case 'deliverable_added':
      embed.description = payload.title || 'New deliverable added';
      if (payload.deliverable_type) {
        embed.fields!.push({ name: 'Type', value: payload.deliverable_type, inline: true });
      }
      if (payload.path) {
        embed.fields!.push({ name: 'Path', value: payload.path });
      }
      break;
  }

  return embed;
}

const VALID_EVENT_TYPES = new Set<DiscordEventType>([
  'task_created', 'task_status_changed', 'run_started',
  'run_completed', 'run_failed', 'deliverable_added',
]);

/**
 * Send a Discord notification for a workspace event.
 * Fails silently (console.error) to never block the main flow.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notifyDiscord(workspaceId: string, eventType: string, payload: any): Promise<void> {
  try {
    // Validate event type
    if (!VALID_EVENT_TYPES.has(eventType as DiscordEventType)) return;
    const validEventType = eventType as DiscordEventType;

    if (!isNotificationEnabled(workspaceId, validEventType)) return;

    const webhookUrl = getWebhookUrl(workspaceId);
    if (!webhookUrl) return;

    const embed = buildEmbed(validEventType, payload);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      // Avoid leaking webhook URL in logs
      console.error(`[Discord] Webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    // Avoid leaking webhook URLs or tokens in error objects
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Discord] Notification error: ${message.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]')}`);
  }
}

export { VALID_EVENT_TYPES };
