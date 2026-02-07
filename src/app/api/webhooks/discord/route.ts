import { NextRequest, NextResponse } from 'next/server';
import { requireLocalhost } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  return NextResponse.json({ message: 'Discord webhook endpoint ready' });
}
