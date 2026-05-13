import { NextResponse } from 'next/server';
import { checkDatabase } from '../../../src/server/db';

export async function GET() {
  try {
    const database = await checkDatabase();
    return NextResponse.json({ ok: true, database });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
