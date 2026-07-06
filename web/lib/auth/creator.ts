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
