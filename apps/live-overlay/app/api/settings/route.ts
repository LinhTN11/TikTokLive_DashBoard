import { NextResponse } from 'next/server';
import { getThemeRules } from '../../../src/server/db';
import { chatThemes } from '../../../src/features/themes/registry';

export async function GET() {
  try {
    const rules = await getThemeRules();
    return NextResponse.json({ themes: chatThemes, rules });
  } catch (error) {
    return NextResponse.json(
      { themes: chatThemes, rules: [], error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
