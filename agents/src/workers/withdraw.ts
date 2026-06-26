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
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await client.getTransaction({ id: txId });
    const tx = res.data?.transaction;
    if (!tx) continue;
    if (tx.state === 'COMPLETE') return tx.txHash ?? txId;
    if (tx.state === 'FAILED' || tx.state === 'DENIED' || tx.state === 'CANCELLED') {
      throw new Error(`[withdraw] transaction ${txId} ${tx.state}: ${tx.errorReason ?? ''}`);
    }
  }
  throw new Error(`[withdraw] transaction ${txId} timed out`);
}

// EIP-712 domain / types for BurnIntent (CLAUDE.md §GATEWAY, Arc domain = 26)
const ARC_DOMAIN = 26;
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
  const { walletId, walletAddress, destinationAddress, amountAtomic } = params;
  const client = getClient();

  const maxFee = 2_010_000n;
  const burnIntent = {
    maxBlockHeight: maxUint256,
    maxFee,
    spec: {
      version: 1,
      sourceDomain: ARC_DOMAIN,
      destinationDomain: ARC_DOMAIN,
      sourceContract: addressToBytes32(GATEWAY_WALLET_ADDRESS),
      destinationContract: addressToBytes32(GATEWAY_MINTER_ADDRESS),
      sourceToken: addressToBytes32(USDC_ADDRESS),
      destinationToken: addressToBytes32(USDC_ADDRESS),
      sourceDepositor: addressToBytes32(walletAddress),
      destinationRecipient: addressToBytes32(destinationAddress),
      sourceSigner: addressToBytes32(walletAddress),
      destinationCaller: addressToBytes32(zeroAddress),
      value: amountAtomic,
      salt: `0x${randomBytes(32).toString('hex')}` as `0x${string}`,
      hookData: '0x' as `0x${string}`,
    },
  };

  // Sign BurnIntent via Circle MPC signTypedData.
  // Circle SDK requires `data: string` (JSON-serialized EIP-712 struct with EIP712Domain in types).
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
        { name: 'name', type: 'string' },
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

  // POST BurnIntent to Gateway /transfer
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

  // Call gatewayMint on GatewayMinter via Circle
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
