/**
 * Discord Notification Service
 * Sends embed messages via Discord webhooks
 * Uses shared i18n locale files from src/i18n/locales/
 */

import { getDb } from './db';
import { translate, type Locale } from '@/i18n/server';
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

/**
 * Get the configured locale for Discord notifications.
 * Reads from: workspace setting > env var > default (zh-TW)
 */
function getLocale(workspaceId?: string): Locale {
  if (workspaceId) {
    try {
      const db = getDb();
      const row = db.prepare(
        'SELECT discord_locale FROM workspaces WHERE id = ?'
      ).get(workspaceId) as { discord_locale?: string } | undefined;
      if (row?.discord_locale && (row.discord_locale === 'en' || row.discord_locale === 'zh-TW')) {
        return row.discord_locale;
      }
    } catch { /* fall through */ }
  }
  const envLocale = process.env.MC_DISCORD_LOCALE;
  if (envLocale === 'en' || envLocale === 'zh-TW') return envLocale;
  return 'zh-TW';
}

function t(locale: Locale, key: string): string {
  return translate(locale, key);
}

function isNotificationEnabled(workspaceId: string, eventType: string): boolean {
  try {
    const db = getDb();
    const setting = db.prepare(
      'SELECT enabled FROM notification_settings WHERE workspace_id = ? AND event_type = ?'
    ).get(workspaceId, eventType) as { enabled: number } | undefined;
    return setting ? setting.enabled === 1 : true;
  } catch {
    return true;
  }
}

function getWebhookUrl(workspaceId: string): string | null {
  try {
    const db = getDb();
    const channel = db.prepare(
      "SELECT webhook_url FROM discord_channels WHERE workspace_id = ? AND channel_type IN ('notification', 'both') AND webhook_url IS NOT NULL LIMIT 1"
    ).get(workspaceId) as { webhook_url: string } | undefined;
    if (channel?.webhook_url) return channel.webhook_url;
  } catch { /* fall through */ }
  return process.env.DISCORD_WEBHOOK_URL || null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEmbed(eventType: DiscordEventType, payload: any, locale: Locale): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: t(locale, `embed.title.${eventType}`),
    color: EVENT_COLORS[eventType] || 0x95a5a6,
    timestamp: new Date().toISOString(),
    fields: [],
  };

  switch (eventType) {
    case 'task_created':
      embed.description = payload.title || t(locale, 'embed.desc.task_created');
      if (payload.description) {
        embed.fields!.push({ name: t(locale, 'embed.field.description'), value: payload.description.slice(0, 200) });
      }
      if (payload.priority) {
        embed.fields!.push({ name: t(locale, 'embed.field.priority'), value: t(locale, `embed.priority.${payload.priority}`), inline: true });
      }
      break;
    case 'task_status_changed':
      embed.description = payload.title || t(locale, 'embed.desc.task_status_changed');
      if (payload.status) {
        const statusText = payload.previous_status
          ? `${t(locale, `embed.status.${payload.previous_status}`)} → ${t(locale, `embed.status.${payload.status}`)}`
          : t(locale, `embed.status.${payload.status}`);
        embed.fields!.push({ name: t(locale, 'embed.field.status'), value: statusText, inline: true });
      }
      break;
    case 'run_started':
      embed.description = t(locale, 'embed.desc.run_started');
      if (payload.taskId) {
        embed.fields!.push({ name: t(locale, 'embed.field.taskId'), value: payload.taskId, inline: true });
      }
      if (payload.cli_type) {
        embed.fields!.push({ name: t(locale, 'embed.field.cli'), value: payload.cli_type, inline: true });
      }
      break;
    case 'run_completed':
      embed.description = t(locale, 'embed.desc.run_completed');
      if (payload.taskId) {
        embed.fields!.push({ name: t(locale, 'embed.field.taskId'), value: payload.taskId, inline: true });
      }
      break;
    case 'run_failed':
      embed.description = t(locale, 'embed.desc.run_failed');
      if (payload.taskId) {
        embed.fields!.push({ name: t(locale, 'embed.field.taskId'), value: payload.taskId, inline: true });
      }
      if (payload.error) {
        embed.fields!.push({ name: t(locale, 'embed.field.error'), value: String(payload.error).slice(0, 200) });
      }
      break;
    case 'deliverable_added':
      embed.description = payload.title || t(locale, 'embed.desc.deliverable_added');
      if (payload.deliverable_type) {
        embed.fields!.push({ name: t(locale, 'embed.field.type'), value: payload.deliverable_type, inline: true });
      }
      if (payload.path) {
        embed.fields!.push({ name: t(locale, 'embed.field.path'), value: payload.path });
      }
      break;
  }

  return embed;
}

/**
 * Build a test embed with i18n support
 */
export function buildTestEmbed(workspaceId: string): DiscordEmbed {
  const locale = getLocale(workspaceId);
  return {
    title: t(locale, 'embed.test.title'),
    description: t(locale, 'embed.test.description'),
    color: 0x3498db,
    timestamp: new Date().toISOString(),
    fields: [
      { name: t(locale, 'embed.test.workspaceId'), value: workspaceId, inline: true },
      { name: t(locale, 'embed.test.status'), value: t(locale, 'embed.test.statusValue'), inline: true },
    ],
  };
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
    if (!VALID_EVENT_TYPES.has(eventType as DiscordEventType)) return;
    const validEventType = eventType as DiscordEventType;

    if (!isNotificationEnabled(workspaceId, validEventType)) return;

    const webhookUrl = getWebhookUrl(workspaceId);
    if (!webhookUrl) return;

    const locale = getLocale(workspaceId);
    const embed = buildEmbed(validEventType, payload, locale);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      console.error(`[Discord] Webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Discord] Notification error: ${message.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]')}`);
  }
}

export { VALID_EVENT_TYPES };
