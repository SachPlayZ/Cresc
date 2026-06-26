// lib/hmac.ts — HMAC auth for Vercel↔EC2 internal calls.
// Both sides share INTERNAL_HMAC_SECRET. Reject if skew > 300s or sig mismatch.

import crypto from 'node:crypto';

const SECRET = process.env.INTERNAL_HMAC_SECRET ?? '';

export function buildHmacHeaders(rawBody: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = hmacSign(SECRET, timestamp, rawBody);
  return {
    'X-Cresc-Timestamp': timestamp,
    'X-Cresc-Signature': sig,
  };
}

export function verifyHmacHeaders(
  headers: { get(k: string): string | null },
  rawBody: string
): boolean {
  const timestamp = headers.get('x-cresc-timestamp');
  const sig = headers.get('x-cresc-signature');
  if (!timestamp || !sig || !SECRET) return false;

  const skew = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (skew > 300) return false;

  const expected = hmacSign(SECRET, timestamp, rawBody);
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
}

function hmacSign(secret: string, timestamp: string, rawBody: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}
