import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteManualViewerThemes, grantManualViewerThemes, listViewers, upsertManualViewerThemes } from '../../../src/server/db';

const manualViewerSchema = z.object({
  channelUniqueId: z.string().min(1),
  viewerUniqueId: z.string().min(1),
  nickname: z.string().optional(),
  themeSlugs: z.array(z.string().min(1)).default([]),
});

const deleteManualViewerSchema = z.object({
  channelUniqueId: z.string().min(1),
  viewerUniqueId: z.string().min(1),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const channelIdParam = url.searchParams.get('channelId');
  const channelId = channelIdParam ? Number(channelIdParam) : undefined;
  const viewers = await listViewers(Number.isFinite(channelId) ? channelId : undefined);
  return NextResponse.json({ viewers });
}

export async function POST(request: Request) {
  const parsed = manualViewerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  await grantManualViewerThemes(parsed.data);
  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  const parsed = manualViewerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  await upsertManualViewerThemes(parsed.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const parsed = deleteManualViewerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  await deleteManualViewerThemes(parsed.data);
  return NextResponse.json({ ok: true });
}
