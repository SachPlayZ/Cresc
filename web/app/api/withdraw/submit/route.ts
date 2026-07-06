import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'deprecated: use /api/withdraw/prepare for content contract withdrawals' },
    { status: 410 }
  );
}
