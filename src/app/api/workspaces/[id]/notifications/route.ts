import { NextRequest, NextResponse } from 'next/server';
import { requireLocalhost } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { NotificationSetting } from '@/lib/types';
import { VALID_EVENT_TYPES } from '@/lib/discord-notify';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { id } = await params;
  const db = getDb();
  const settings = db.prepare('SELECT * FROM notification_settings WHERE workspace_id = ? ORDER BY event_type').all(id) as NotificationSetting[];

  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await request.json();
  const { settings } = body;

  if (!Array.isArray(settings)) {
    return NextResponse.json({ error: 'settings must be an array' }, { status: 400 });
  }

  const db = getDb();
  
  // Update notification settings in a transaction
  db.transaction(() => {
    for (const setting of settings) {
      const { event_type, enabled } = setting;
      
      if (!event_type || typeof enabled !== 'boolean') {
        throw new Error('Invalid setting: event_type and enabled are required');
      }

      // Validate event_type against whitelist
      if (!VALID_EVENT_TYPES.has(event_type)) {
        throw new Error(`Invalid event_type: ${event_type}`);
      }

      // Upsert using INSERT OR REPLACE (relies on UNIQUE constraint)
      db.prepare(
        'INSERT OR REPLACE INTO notification_settings (id, workspace_id, event_type, enabled) VALUES (?, ?, ?, ?)'
      ).run(randomUUID(), id, event_type, enabled ? 1 : 0);
    }
  })();

  const updatedSettings = db.prepare('SELECT * FROM notification_settings WHERE workspace_id = ? ORDER BY event_type').all(id) as NotificationSetting[];
  return NextResponse.json(updatedSettings);
}