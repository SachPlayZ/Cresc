import { NextRequest, NextResponse } from 'next/server';
import { createDeviceToken } from '../../../../lib/circle/ucw';

export async function POST(req: NextRequest) {
  try {
    const { deviceId } = await req.json() as { deviceId?: string };
    if (!deviceId) return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
    const result = await createDeviceToken(deviceId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
