// POST /api/withdraw/prepare
// Builds BurnIntent + creates UCW signTypedData challenge.
// Browser executes challenge via W3S SDK to get signature, then calls /api/withdraw/submit.

import { NextRequest, NextResponse } from 'next/server';
import { maxUint256, zeroAddress } from 'viem';
import { randomBytes } from 'node:crypto';
import { createServerClient } from '../../../../lib/db';
import { createSignTypedDataChallenge } from '../../../../lib/circle/ucw';
import {
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_MINTER_ADDRESS,
  USDC_ADDRESS,
} from '../../../../lib/config';

const ARC_DOMAIN = 26;
const EIP712_BURN_DOMAIN = { name: 'GatewayWallet', version: '1' };
const BURN_INTENT_TYPES = {
  EIP712Domain: [
    { name: 'name',    type: 'string' },
    { name: 'version', type: 'string' },
  ],
  TransferSpec: [
    { name: 'version',              type: 'uint32' },
    { name: 'sourceDomain',         type: 'uint32' },
    { name: 'destinationDomain',    type: 'uint32' },
    { name: 'sourceContract',       type: 'bytes32' },
    { name: 'destinationContract',  type: 'bytes32' },
    { name: 'sourceToken',          type: 'bytes32' },
    { name: 'destinationToken',     type: 'bytes32' },
    { name: 'sourceDepositor',      type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner',         type: 'bytes32' },
    { name: 'destinationCaller',    type: 'bytes32' },
    { name: 'value',                type: 'uint256' },
    { name: 'salt',                 type: 'bytes32' },
    { name: 'hookData',             type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee',         type: 'uint256' },
    { name: 'spec',           type: 'TransferSpec' },
  ],
};

const CCTP_DOMAINS: Record<string, number> = {
  'arc': 26, 'arc-testnet': 26, 'arctestnet': 26,
  'ethereum': 0, 'eth': 0,
  'avalanche': 1, 'avax': 1,
  'op-mainnet': 2, 'optimism': 2, 'op': 2,
  'arbitrum': 3, 'arb': 3,
  'base': 6,
  'polygon': 7, 'matic': 7,
};

function getCctpDomain(chain: string): number {
  const domain = CCTP_DOMAINS[chain.toLowerCase().replace(/[\s_]/g, '-')];
  if (domain === undefined) throw new Error(`Unknown chain: ${chain}`);
  return domain;
}

function addressToBytes32(addr: string): string {
  return '0x' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

const serialize = (v: unknown): unknown =>
  typeof v === 'bigint'
    ? v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
    : Array.isArray(v) ? v.map(serialize)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, serialize(val)]))
    : v;

export async function POST(req: NextRequest) {
  try {
    const { creator_id, userToken, amount_atomic, destination_chain, destination_address } =
      await req.json() as {
        creator_id?: string;
        userToken?: string;
        amount_atomic?: string;
        destination_chain?: string;
        destination_address?: string;
      };

    if (!creator_id || !userToken || !amount_atomic || !destination_chain || !destination_address) {
      return NextResponse.json({ error: 'creator_id, userToken, amount_atomic, destination_chain, destination_address required' }, { status: 400 });
    }

    const db = createServerClient();
    const { data: creator } = await db
      .from('creators')
      .select('circle_wallet_id, eoa_address')
      .eq('id', creator_id)
      .single();

    if (!creator?.circle_wallet_id || !creator?.eoa_address) {
      return NextResponse.json({ error: 'creator wallet not provisioned' }, { status: 400 });
    }

    const destinationDomain = getCctpDomain(destination_chain);
    const amountAtomic = BigInt(amount_atomic);

    const burnIntent = {
      maxBlockHeight: maxUint256,
      maxFee: 2_010_000n,
      spec: {
        version: 1,
        sourceDomain: ARC_DOMAIN,
        destinationDomain,
        sourceContract:       addressToBytes32(GATEWAY_WALLET_ADDRESS),
        destinationContract:  addressToBytes32(GATEWAY_MINTER_ADDRESS),
        sourceToken:          addressToBytes32(USDC_ADDRESS),
        destinationToken:     addressToBytes32(USDC_ADDRESS),
        sourceDepositor:      addressToBytes32(creator.eoa_address),
        destinationRecipient: addressToBytes32(destination_address),
        sourceSigner:         addressToBytes32(creator.eoa_address),
        destinationCaller:    addressToBytes32(zeroAddress),
        value: amountAtomic,
        salt: `0x${randomBytes(32).toString('hex')}`,
        hookData: '0x',
      },
    };

    const eip712Data = serialize({
      types: BURN_INTENT_TYPES,
      domain: EIP712_BURN_DOMAIN,
      primaryType: 'BurnIntent',
      message: burnIntent,
    });

    const challengeId = await createSignTypedDataChallenge(
      userToken,
      creator.circle_wallet_id as string,
      eip712Data as Record<string, unknown>
    );

    // Record withdrawal attempt before signing
    const { data: withdrawal } = await db
      .from('withdrawals')
      .insert({
        creator_id,
        amount_atomic,
        destination_chain,
        destination_address,
        status: 'submitted',
      })
      .select('id')
      .single();

    return NextResponse.json({
      challengeId,
      burnIntent: JSON.parse(JSON.stringify(burnIntent, (_, v) => typeof v === 'bigint' ? v.toString() : v)),
      withdrawalId: withdrawal?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
