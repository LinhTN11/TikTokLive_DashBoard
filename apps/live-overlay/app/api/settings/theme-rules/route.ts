import { NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertThemeRules } from '../../../../src/server/db';

const ruleSchema = z.object({
  themeSlug: z.string().min(1),
  thresholdDiamonds: z.coerce.number().int().min(0),
  unlockMode: z.enum(['lifetime', 'session']),
  enabled: z.boolean(),
});

const payloadSchema = z.object({
  rules: z.array(ruleSchema),
});

export async function PUT(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  await upsertThemeRules(parsed.data.rules);
  return NextResponse.json({ ok: true });
}
