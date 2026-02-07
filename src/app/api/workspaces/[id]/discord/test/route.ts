import { NextRequest, NextResponse } from 'next/server';
import { requireLocalhost } from '@/lib/auth';
import { buildTestEmbed } from '@/lib/discord-notify';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { id } = await params;
  const body = await request.json();
  const { webhook_url } = body;

  if (!webhook_url) {
    return NextResponse.json({ error: 'webhook_url is required' }, { status: 400 });
  }

  try {
    const testEmbed = buildTestEmbed(id);

    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [testEmbed] }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ 
        error: `Discord API error: ${response.status} ${response.statusText}`,
        details: errorText
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Test notification sent successfully' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Discord Test] Error: ${message.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]')}`);
    return NextResponse.json({ 
      error: 'Failed to send test notification',
      details: message.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]')
    }, { status: 500 });
  }
}
