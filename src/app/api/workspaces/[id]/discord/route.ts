import { NextRequest, NextResponse } from 'next/server';
import { requireLocalhost } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { DiscordChannel } from '@/lib/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { id } = await params;
  const db = getDb();
  const channels = db.prepare('SELECT * FROM discord_channels WHERE workspace_id = ? ORDER BY created_at DESC').all(id) as DiscordChannel[];

  return NextResponse.json(channels);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await request.json();
  const { channel_id, channel_name, channel_type, webhook_url } = body;

  if (!channel_id || !channel_name || !channel_type) {
    return NextResponse.json({ error: 'channel_id, channel_name, and channel_type are required' }, { status: 400 });
  }

  if (!['notification', 'command', 'both'].includes(channel_type)) {
    return NextResponse.json({ error: 'channel_type must be notification, command, or both' }, { status: 400 });
  }

  const db = getDb();
  const newId = randomUUID();
  db.prepare(
    'INSERT INTO discord_channels (id, workspace_id, channel_id, channel_name, channel_type, webhook_url) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId, id, channel_id, channel_name, channel_type, webhook_url || null);

  const created = db.prepare('SELECT * FROM discord_channels WHERE id = ?').get(newId) as DiscordChannel;
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await request.json();
  const { channel_id } = body;

  if (!channel_id) {
    return NextResponse.json({ error: 'channel_id is required' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM discord_channels WHERE workspace_id = ? AND id = ?').run(id, channel_id);

  if (result.changes === 0) {
    return NextResponse.json({ error: 'Channel mapping not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
