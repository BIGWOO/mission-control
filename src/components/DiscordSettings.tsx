'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, TestTube, Hash, Bell, BellOff } from 'lucide-react';
import { useTranslation } from '@/i18n';
import type { DiscordChannel, NotificationSetting, DiscordChannelType, DiscordEventType } from '@/lib/types';

interface DiscordSettingsProps {
  workspaceId: string;
}

const notifiableEvents = [
  'task_created',
  'task_status_changed',
  'run_started',
  'run_completed',
  'run_failed',
  'deliverable_added',
] as const;

export function DiscordSettings({ workspaceId }: DiscordSettingsProps) {
  const { t } = useTranslation();
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [notifications, setNotifications] = useState<NotificationSetting[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    channel_id: '',
    channel_name: '',
    channel_type: 'notification' as DiscordChannelType,
    webhook_url: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState<string | null>(null);
  const [discordLocale, setDiscordLocale] = useState<'en' | 'zh-TW'>('zh-TW');

  // Load channels, notification settings, and locale
  useEffect(() => {
    loadChannels();
    loadNotifications();
    loadLocale();
  }, [workspaceId]);

  const loadLocale = async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.discord_locale) setDiscordLocale(data.discord_locale);
      }
    } catch { /* ignore */ }
  };

  const updateLocale = async (locale: 'en' | 'zh-TW') => {
    setDiscordLocale(locale);
    try {
      await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_locale: locale }),
      });
    } catch { /* ignore */ }
  };

  const loadChannels = async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/discord`);
      if (response.ok) {
        const data = await response.json();
        setChannels(data);
      }
    } catch (error) {
      console.error('Failed to load Discord channels:', error);
    }
  };

  const loadNotifications = async () => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/notifications`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error('Failed to load notification settings:', error);
    }
  };

  const handleAddChannel = async () => {
    if (!formData.channel_id || !formData.channel_name) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/discord`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setFormData({
          channel_id: '',
          channel_name: '',
          channel_type: 'notification',
          webhook_url: '',
        });
        setShowAddForm(false);
        await loadChannels();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to add channel');
      }
    } catch (error) {
      alert('Failed to add channel');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    if (!confirm(t('discord.confirmRemove'))) return;

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/discord`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId }),
      });

      if (response.ok) {
        await loadChannels();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to remove channel');
      }
    } catch (error) {
      alert('Failed to remove channel');
    }
  };

  const handleTestWebhook = async (webhookUrl: string) => {
    if (!webhookUrl) {
      alert(t('discord.noWebhookUrl'));
      return;
    }

    setTestingWebhook(webhookUrl);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/discord/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });

      if (response.ok) {
        alert(t('discord.testSuccess'));
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to send test notification');
      }
    } catch (error) {
      alert('Failed to send test notification');
    } finally {
      setTestingWebhook(null);
    }
  };

  const handleNotificationToggle = async (eventType: string, enabled: boolean) => {
    try {
      const updatedSettings = notifications.map(setting =>
        setting.event_type === eventType ? { ...setting, enabled: enabled ? 1 : 0 } : setting
      );
      
      // If the setting doesn't exist, add it
      if (!notifications.find(s => s.event_type === eventType)) {
        updatedSettings.push({
          id: '',
          workspace_id: workspaceId,
          event_type: eventType as DiscordEventType,
          enabled: enabled ? 1 : 0,
          created_at: new Date().toISOString(),
        });
      }

      const response = await fetch(`/api/workspaces/${workspaceId}/notifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: updatedSettings.map(s => ({
            event_type: s.event_type,
            enabled: Boolean(s.enabled),
          }))
        }),
      });

      if (response.ok) {
        await loadNotifications();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update notification settings');
      }
    } catch (error) {
      alert('Failed to update notification settings');
    }
  };

  const isNotificationEnabled = (eventType: string): boolean => {
    const setting = notifications.find(s => s.event_type === eventType);
    return setting ? Boolean(setting.enabled) : true; // Default to enabled
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-mc-text mb-2">{t('discord.settings')}</h2>
        <p className="text-sm text-mc-text-secondary">{t('discord.description')}</p>
      </div>

      {/* Discord Channels */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-md font-medium text-mc-text">{t('discord.channels')}</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-3 py-1 text-sm bg-mc-accent text-mc-bg rounded hover:bg-mc-accent/90"
          >
            <Plus className="w-4 h-4" />
            {t('discord.addChannel')}
          </button>
        </div>

        {/* Add Channel Form */}
        {showAddForm && (
          <div className="p-4 bg-mc-surface rounded border border-mc-border space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-mc-text-secondary mb-1">
                  {t('discord.channelId')}
                </label>
                <input
                  type="text"
                  value={formData.channel_id}
                  onChange={(e) => setFormData({ ...formData, channel_id: e.target.value })}
                  placeholder="123456789012345678"
                  className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm text-mc-text placeholder-mc-text-muted focus:border-mc-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-mc-text-secondary mb-1">
                  {t('discord.channelName')}
                </label>
                <input
                  type="text"
                  value={formData.channel_name}
                  onChange={(e) => setFormData({ ...formData, channel_name: e.target.value })}
                  placeholder="#mission-control"
                  className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm text-mc-text placeholder-mc-text-muted focus:border-mc-accent focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-mc-text-secondary mb-1">
                {t('discord.channelType')}
              </label>
              <select
                value={formData.channel_type}
                onChange={(e) => setFormData({ ...formData, channel_type: e.target.value as DiscordChannelType })}
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm text-mc-text focus:border-mc-accent focus:outline-none"
              >
                <option value="notification">{t('discord.notificationOnly')}</option>
                <option value="command">{t('discord.commandOnly')}</option>
                <option value="both">{t('discord.both')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-mc-text-secondary mb-1">
                {t('discord.webhookUrl')} <span className="text-mc-text-muted">({t('optional')})</span>
              </label>
              <input
                type="url"
                value={formData.webhook_url}
                onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 bg-mc-bg border border-mc-border rounded text-sm text-mc-text placeholder-mc-text-muted focus:border-mc-accent focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddChannel}
                disabled={isLoading || !formData.channel_id || !formData.channel_name}
                className="px-4 py-2 bg-mc-accent text-mc-bg rounded text-sm font-medium hover:bg-mc-accent/90 disabled:opacity-50"
              >
                {isLoading ? t('adding') : t('add')}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({ channel_id: '', channel_name: '', channel_type: 'notification', webhook_url: '' });
                }}
                className="px-4 py-2 border border-mc-border text-mc-text rounded text-sm hover:bg-mc-surface"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Channels List */}
        <div className="space-y-2">
          {channels.length === 0 ? (
            <p className="text-sm text-mc-text-secondary italic">{t('discord.noChannels')}</p>
          ) : (
            channels.map((channel) => (
              <div
                key={channel.id}
                className="p-3 bg-mc-surface rounded border border-mc-border flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Hash className="w-4 h-4 text-mc-text-secondary" />
                  <div>
                    <div className="text-sm font-medium text-mc-text">
                      {channel.channel_name}
                    </div>
                    <div className="text-xs text-mc-text-secondary">
                      ID: {channel.channel_id} • {t(`discord.type.${channel.channel_type}`)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {channel.webhook_url && (
                    <button
                      onClick={() => handleTestWebhook(channel.webhook_url!)}
                      disabled={testingWebhook === channel.webhook_url}
                      className="p-1 text-mc-accent hover:bg-mc-accent/10 rounded"
                      title={t('discord.testWebhook')}
                    >
                      <TestTube className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveChannel(channel.id)}
                    className="p-1 text-mc-accent-red hover:bg-mc-accent-red/10 rounded"
                    title={t('remove')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Notification Language */}
      <div className="space-y-2">
        <h3 className="text-md font-medium text-mc-text">{t('discord.notificationLanguage')}</h3>
        <p className="text-sm text-mc-text-muted">{t('discord.notificationLanguageDesc')}</p>
        <div className="flex gap-2">
          <button
            onClick={() => updateLocale('zh-TW')}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              discordLocale === 'zh-TW'
                ? 'bg-mc-accent text-white'
                : 'bg-mc-surface text-mc-text border border-mc-border hover:bg-mc-border'
            }`}
          >
            繁體中文
          </button>
          <button
            onClick={() => updateLocale('en')}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              discordLocale === 'en'
                ? 'bg-mc-accent text-white'
                : 'bg-mc-surface text-mc-text border border-mc-border hover:bg-mc-border'
            }`}
          >
            English
          </button>
        </div>
      </div>

      {/* Notification Settings */}
      <div className="space-y-4">
        <h3 className="text-md font-medium text-mc-text">{t('discord.notificationEvents')}</h3>
        <div className="space-y-2">
          {notifiableEvents.map((eventType) => (
            <div
              key={eventType}
              className="flex items-center justify-between p-3 bg-mc-surface rounded border border-mc-border"
            >
              <div className="flex items-center gap-3">
                {isNotificationEnabled(eventType) ? (
                  <Bell className="w-4 h-4 text-mc-accent" />
                ) : (
                  <BellOff className="w-4 h-4 text-mc-text-muted" />
                )}
                <div>
                  <div className="text-sm font-medium text-mc-text">
                    {t(`discord.events.${eventType}`)}
                  </div>
                  <div className="text-xs text-mc-text-secondary">
                    {t(`discord.events.${eventType}_desc`)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleNotificationToggle(eventType, !isNotificationEnabled(eventType))}
                className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                  isNotificationEnabled(eventType) ? 'bg-mc-accent' : 'bg-mc-border'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    isNotificationEnabled(eventType) ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                  style={{ marginTop: '2px' }}
                />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}