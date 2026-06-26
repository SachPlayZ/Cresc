// EC2 withdraw worker — Circle MPC BurnIntent withdrawal from Gateway.
// Mirrors web/lib/circle/wallets.ts::withdrawFromGatewayCircle().
// Lives on EC2 because it requires CIRCLE_ENTITY_SECRET (Circle API entity secret).

import crypto from 'node:crypto';
import { pad, zeroAddress, maxUint256 } from 'viem';
import { randomBytes } from 'node:crypto';
import {
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';
import {
  CIRCLE_API_KEY,
  CIRCLE_ENTITY_SECRET,
  USDC_ADDRESS,
  GATEWAY_WALLET_ADDRESS,
  GATEWAY_MINTER_ADDRESS,
  GATEWAY_FACILITATOR_URL,
} from '../config.js';

export type WithdrawParams = {
  walletId: string;
  walletAddress: string;
  destinationAddress: string;
  destinationChain: string;
  amountAtomic: bigint;
};

// CCTP V2 domain numbers. Arc Testnet = 26. Add chains as needed.
// Reference: https://developers.circle.com/stablecoins/docs/cctp-technical-reference
const CCTP_DOMAIN_MAP: Record<string, number> = {
  'arc':          26,
  'arc-testnet':  26,
  'arctestnet':   26,
  'ethereum':     0,
  'eth':          0,
  'avalanche':    1,
  'avax':         1,
  'op-mainnet':   2,
  'optimism':     2,
  'op':           2,
  'arbitrum':     3,
  'arb':          3,
  'base':         6,
  'polygon':      7,
  'matic':        7,
};

function getCctpDomain(chain: string): number {
  const key = chain.toLowerCase().replace(/[\s_]/g, '-');
  const domain = CCTP_DOMAIN_MAP[key];
  if (domain === undefined) {
    throw new Error(
      `[withdraw] Unknown destination chain: "${chain}". ` +
      `Supported: ${Object.keys(CCTP_DOMAIN_MAP).join(', ')}`
    );
  }
  return domain;
}

let _client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

function getClient() {
  if (!_client) {
    _client = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });
  }
  return _client;
}

async function pollTransaction(txId: string): Promise<string> {
  const client = getClient();
  // Exponential backoff: 2s, 4s, 6s, 8s... capped at 10s, up to 120s total
  for (let i = 0; i < 30; i++) {
    const delayMs = Math.min(2000 + i * 2000, 10_000);
    await new Promise((r) => setTimeout(r, delayMs));
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    if (!tx) continue;
    if (tx.state === 'COMPLETE') return tx.txHash ?? txId;
    if (tx.state === 'FAILED' || tx.state === 'DENIED' || tx.state === 'CANCELLED') {
      throw new Error(`[withdraw] transaction ${txId} ${tx.state}: ${tx.errorReason ?? ''}`);
    }
  }
  throw new Error(`[withdraw] transaction ${txId} timed out after ~120s`);
}

// EIP-712 domain / types for BurnIntent (CLAUDE.md §GATEWAY)
const EIP712_BURN_DOMAIN = { name: 'GatewayWallet', version: '1' };
const BURN_INTENT_TYPES = {
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

function addressToBytes32(addr: string): `0x${string}` {
  return pad(addr.toLowerCase() as `0x${string}`, { size: 32, dir: 'left' });
}

export async function executeWithdraw(params: WithdrawParams): Promise<string> {
  const { walletId, walletAddress, destinationAddress, destinationChain, amountAtomic } = params;

  const sourceDomain = 26; // Arc Testnet is always the source
  const destinationDomain = getCctpDomain(destinationChain); // correctly mapped from chain name

  if (destinationDomain !== sourceDomain) {
    // Cross-chain CCTP V2 mint requires native gas on the destination chain.
    // The creator's Circle wallet on the destination chain must have gas.
    // Verify this before initiating — a failed mint wastes the burn fee.
    console.warn(
      `[withdraw] Cross-chain withdrawal to domain ${destinationDomain} (${destinationChain}). ` +
      `Ensure the creator wallet ${walletAddress} has native gas on the destination chain ` +
      `before the gatewayMint transaction is broadcast.`
    );
  }

  const client = getClient();

  const maxFee = 2_010_000n;
  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee,
    spec: {
      version: 1,
      sourceDomain,
      destinationDomain,
      sourceContract:        addressToBytes32(GATEWAY_WALLET_ADDRESS),
      destinationContract:   addressToBytes32(GATEWAY_MINTER_ADDRESS),
      sourceToken:           addressToBytes32(USDC_ADDRESS),
      destinationToken:      addressToBytes32(USDC_ADDRESS),
      sourceDepositor:       addressToBytes32(walletAddress),
      destinationRecipient:  addressToBytes32(destinationAddress),
      sourceSigner:          addressToBytes32(walletAddress),
      destinationCaller:     addressToBytes32(zeroAddress),
      value: amountAtomic,
      salt: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
      hookData: '0x' as `0x${string}`,
    },
  };

  // Sign BurnIntent via Circle MPC signTypedData.
  const serialize = (v: unknown): unknown =>
    typeof v === 'bigint'
      ? v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
      : Array.isArray(v) ? v.map(serialize)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, serialize(val)]))
      : v;

  const eip712Data = serialize({
    types: {
      EIP712Domain: [
        { name: 'name',    type: 'string' },
        { name: 'version', type: 'string' },
      ],
      ...BURN_INTENT_TYPES,
    },
    domain: EIP712_BURN_DOMAIN,
    primaryType: 'BurnIntent',
    message: burnIntent,
  });

  const signResp = await client.signTypedData({
    walletId,
    data: JSON.stringify(eip712Data),
  });

  const { signature } = signResp.data as { signature: string };
  if (!signature) throw new Error('[withdraw] signTypedData returned no signature');

  // POST BurnIntent to Gateway /transfer for attestation
  const transferRes = await fetch(`${GATEWAY_FACILITATOR_URL}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      [{ burnIntent, signature }],
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    ),
  });

  const transferJson = await transferRes.json() as { attestation?: string; signature?: string };
  if (!transferJson.attestation || !transferJson.signature) {
    throw new Error(`[withdraw] Gateway /transfer error: ${JSON.stringify(transferJson)}`);
  }

  // Call gatewayMint on GatewayMinter via Circle (handles cross-chain dispatch)
  const mintResp = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: GATEWAY_MINTER_ADDRESS,
    abiFunctionSignature: 'gatewayMint(bytes,bytes)',
    abiParameters: [transferJson.attestation, transferJson.signature],
    idempotencyKey: crypto.randomUUID(),
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const mintTxId = mintResp.data?.id;
  if (!mintTxId) throw new Error('[withdraw] gatewayMint: no tx id');
  return pollTransaction(mintTxId);
}
