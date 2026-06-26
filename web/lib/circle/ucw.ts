/**
 * lib/circle/ucw.ts — Circle user-controlled wallets backend client.
 * Server-side only (holds CIRCLE_API_KEY, never exposed to browser).
 * Handles: device token creation, wallet challenge creation, wallet listing, signTypedData.
 */

import { createRequire } from 'node:module';
import type { CircleUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { CIRCLE_API_KEY } from '../config';

const _req = createRequire(import.meta.url);
const { initiateUserControlledWalletsClient } = _req(
  '@circle-fin/user-controlled-wallets'
) as typeof import('@circle-fin/user-controlled-wallets');

const ARC_TESTNET = 'ARC-TESTNET' as const;

let _client: CircleUserControlledWalletsClient | null = null;

function getClient(): CircleUserControlledWalletsClient {
  if (!_client) {
    if (!CIRCLE_API_KEY) throw new Error('[ucw] CIRCLE_API_KEY required');
    _client = initiateUserControlledWalletsClient({ apiKey: CIRCLE_API_KEY });
  }
  return _client;
}

export const isUcwMode = !!CIRCLE_API_KEY;

/** Step 1 of social login: exchange deviceId for deviceToken + deviceEncryptionKey. */
export async function createDeviceToken(
  deviceId: string
): Promise<{ deviceToken: string; deviceEncryptionKey: string }> {
  const resp = await getClient().createDeviceTokenForSocialLogin({ deviceId });
  const { deviceToken, deviceEncryptionKey } = resp.data ?? {};
  if (!deviceToken || !deviceEncryptionKey) {
    throw new Error('[ucw] createDeviceToken: missing token in response');
  }
  return { deviceToken, deviceEncryptionKey };
}

/**
 * Step 3 of social login: initialize Circle user + create wallet challenge.
 * Returns { challengeId } on first-time setup.
 * Returns { alreadyExists: true, wallets } if user already has wallets (error 155106).
 */
export async function initUserWallet(
  userToken: string
): Promise<{ challengeId: string } | { alreadyExists: true; wallets: UcwWallet[] }> {
  try {
    const resp = await getClient().createUserPinWithWallets({
      userToken,
      blockchains: [ARC_TESTNET],
      accountType: 'EOA',
    });
    const challengeId = resp.data?.challengeId;
    if (!challengeId) throw new Error('[ucw] initUserWallet: no challengeId');
    return { challengeId };
  } catch (err: unknown) {
    // 155106 = user already initialized
    if (isCircleError(err, 155106)) {
      const wallets = await listUserWallets(userToken);
      return { alreadyExists: true, wallets };
    }
    throw err;
  }
}

export type UcwWallet = { id: string; address: string; blockchain: string };

/** List EOA wallets on ARC-TESTNET for the given userToken. */
export async function listUserWallets(userToken: string): Promise<UcwWallet[]> {
  const resp = await getClient().listWallets({ userToken });
  const wallets = resp.data?.wallets ?? [];
  return wallets
    .filter((w) => (w.blockchain as string) === ARC_TESTNET && !(w as unknown as { custodyType?: string }).custodyType?.includes('DEVELOPER'))
    .map((w) => ({ id: w.id ?? '', address: w.address ?? '', blockchain: (w.blockchain as string) ?? '' }));
}

/**
 * Create an EIP-712 signTypedData challenge (for BurnIntent signing during withdrawal).
 * Returns challengeId — browser executes this via W3S SDK.
 */
export async function createSignTypedDataChallenge(
  userToken: string,
  walletId: string,
  eip712Data: Record<string, unknown>
): Promise<string> {
  const resp = await getClient().signTypedData({
    userToken,
    walletId,
    data: JSON.stringify(eip712Data),
  });
  const challengeId = resp.data?.challengeId;
  if (!challengeId) throw new Error('[ucw] createSignTypedDataChallenge: no challengeId');
  return challengeId;
}

function isCircleError(err: unknown, code: number): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e['code'] === code) return true;
    const data = e['response'] as Record<string, unknown> | undefined;
    if (data?.['code'] === code) return true;
  }
  return false;
}
