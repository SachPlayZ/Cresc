import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { listUserWallets } from '../circle/ucw';

const HMAC_SECRET = process.env.INTERNAL_HMAC_SECRET ?? '';

// Capability token proving "this caller is the one who just created creator row X" —
// covers the window between creator creation and first wallet binding, where there is
// no wallet yet to check ownership against. Stateless (no DB column, no extra secret):
// same HMAC primitive already used for Vercel<->EC2 auth (web/lib/hmac.ts).
export function generateOnboardingToken(creatorId: string): string {
  return crypto.createHmac('sha256', HMAC_SECRET).update(creatorId).digest('hex');
}

export function verifyOnboardingToken(creatorId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = generateOnboardingToken(creatorId);
  const tokenBuf = Buffer.from(token, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return tokenBuf.length === expectedBuf.length && crypto.timingSafeEqual(tokenBuf, expectedBuf);
}

// Signed session cookie proving "the bearer is creator X" — same HMAC primitive
// as the onboarding token above, but long-lived and expiry-bearing so it can back
// a real login/logout cycle instead of just the one-time onboarding window.
export const SESSION_COOKIE_NAME = 'cresc_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function generateSessionToken(creatorId: string): string {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(`${expiry}:${creatorId}`).digest('hex');
  return `${expiry}:${creatorId}:${sig}`;
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [expiryStr, creatorId, sig] = parts;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return null;

  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(`${expiryStr}:${creatorId}`).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  return creatorId;
}

type CreatorWalletRow = {
  id: string;
  circle_wallet_id: string | null;
  eoa_address: string | null;
};

export async function assertCreatorOwnership(
  db: SupabaseClient,
  creatorId: string,
  userToken: string
): Promise<CreatorWalletRow> {
  if (!creatorId || !userToken) {
    throw new Error('creator_id and userToken required');
  }

  const { data: creator, error } = await db
    .from('creators')
    .select('id, circle_wallet_id, eoa_address')
    .eq('id', creatorId)
    .single();

  if (error || !creator) {
    throw new Error('creator not found');
  }

  const wallets = await listUserWallets(userToken);
  if (wallets.length === 0) {
    throw new Error('no Circle wallet found for userToken');
  }

  const owns = wallets.some((wallet) => {
    const sameId = creator.circle_wallet_id && wallet.id === creator.circle_wallet_id;
    const sameAddress = creator.eoa_address &&
      wallet.address.toLowerCase() === creator.eoa_address.toLowerCase();
    return sameId || sameAddress;
  });

  if (!owns) {
    throw new Error('creator ownership check failed');
  }

  return creator as CreatorWalletRow;
}
