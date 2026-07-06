import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  CONTENT_FACTORY_ADDRESS,
  CONTENT_TUNER_ADDRESS,
  CONTENT_TUNER_PRIVATE_KEY,
  USDC_ADDRESS,
} from '../config.js';

const factoryAbi = [
  {
    name: 'contentContracts',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'contentId', type: 'bytes32' }],
    outputs: [{ name: 'contentContract', type: 'address' }],
  },
  {
    name: 'createContent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'contentId', type: 'bytes32' },
      { name: 'creatorId', type: 'string' },
      { name: 'creator', type: 'address' },
      { name: 'initialPriceAtomic', type: 'uint256' },
      { name: 'metadataURI', type: 'string' },
      { name: 'metadataHash', type: 'bytes32' },
      { name: 'priceTuner', type: 'address' },
    ],
    outputs: [{ name: 'contentContract', type: 'address' }],
  },
] as const;

const vaultAbi = [
  {
    name: 'priceAtomic',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tunePrice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newPriceAtomic', type: 'uint256' },
      { name: 'reasonHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amountAtomic', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdrawSigned',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amountAtomic', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'withdrawNonce',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL || 'https://arc-testnet.drpc.org'] } },
});

export type ContentInput = {
  creator_id: string;
  creator_wallet: string;
  slug: string;
  ghost_post_id: string;
  title: string;
  excerpt: string;
  ghost_instance_url?: string | null;
  initial_price_atomic?: string | number | bigint;
};

export type ContentDeployment = {
  content_id: string;
  content_contract: string;
  metadata_uri: string;
  metadata_hash: string;
  tx_hash: string | null;
  status: 'confirmed' | 'mock';
};

export function buildContentId(creatorId: string, ghostPostId: string, slug: string): `0x${string}` {
  return keccak256(toHex(`${creatorId}:${ghostPostId || slug}`));
}

function mockContractAddress(contentId: `0x${string}`): `0x${string}` {
  return `0x${contentId.slice(-40)}` as `0x${string}`;
}

function getPublicClient() {
  return createPublicClient({ chain: arcTestnetChain, transport: http(ARC_RPC_URL) });
}

function getTunerAccount() {
  if (!CONTENT_TUNER_PRIVATE_KEY) return null;
  return privateKeyToAccount(CONTENT_TUNER_PRIVATE_KEY as `0x${string}`);
}

function getTunerAddress(): `0x${string}` | null {
  const account = getTunerAccount();
  if (account) return account.address;
  return CONTENT_TUNER_ADDRESS ? CONTENT_TUNER_ADDRESS as `0x${string}` : null;
}

export async function ensureContentContract(
  db: SupabaseClient,
  input: ContentInput
): Promise<ContentDeployment> {
  const contentId = buildContentId(input.creator_id, input.ghost_post_id, input.slug);
  const initialPrice = BigInt(input.initial_price_atomic ?? 50000);
  const metadata = {
    creator_id: input.creator_id,
    ghost_post_id: input.ghost_post_id,
    slug: input.slug,
    canonical_url: input.ghost_instance_url ? `${input.ghost_instance_url.replace(/\/$/, '')}/${input.slug}` : '',
    title: input.title,
    excerpt_hash: keccak256(toHex(input.excerpt ?? '')),
    created_at: new Date().toISOString(),
  };
  const metadataUri = `cresc://ghost/${input.creator_id}/${input.ghost_post_id || input.slug}`;
  const metadataHash = keccak256(toHex(JSON.stringify(metadata)));
  const tunerAddress = getTunerAddress();
  const liveFactory = !!(ARC_RPC_URL && CONTENT_FACTORY_ADDRESS && CONTENT_TUNER_PRIVATE_KEY && tunerAddress);

  const { data: existing } = await db
    .from('articles')
    .select('content_contract, factory_tx')
    .eq('content_id', contentId)
    .maybeSingle();
  if (existing?.content_contract && (!liveFactory || existing.factory_tx)) {
    return {
      content_id: contentId,
      content_contract: existing.content_contract as string,
      metadata_uri: metadataUri,
      metadata_hash: metadataHash,
      tx_hash: existing.factory_tx as string | null,
      status: existing.factory_tx ? 'confirmed' : 'mock',
    };
  }

  let contentContract = mockContractAddress(contentId);
  let txHash: string | null = null;
  let status: 'confirmed' | 'mock' = 'mock';

  if (liveFactory) {
    const account = getTunerAccount();
    if (!account) throw new Error('[content] CONTENT_TUNER_PRIVATE_KEY required');
    const publicClient = getPublicClient();
    const current = await publicClient.readContract({
      address: CONTENT_FACTORY_ADDRESS as `0x${string}`,
      abi: factoryAbi,
      functionName: 'contentContracts',
      args: [contentId],
    });

    if (current && current !== '0x0000000000000000000000000000000000000000') {
      contentContract = current;
      status = 'confirmed';
    } else {
      const walletClient = createWalletClient({
        account,
        chain: arcTestnetChain,
        transport: http(ARC_RPC_URL),
      });
      txHash = await walletClient.writeContract({
        address: CONTENT_FACTORY_ADDRESS as `0x${string}`,
        abi: factoryAbi,
        functionName: 'createContent',
        args: [
          contentId,
          input.creator_id,
          input.creator_wallet as `0x${string}`,
          initialPrice,
          metadataUri,
          metadataHash,
          tunerAddress,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      contentContract = await publicClient.readContract({
        address: CONTENT_FACTORY_ADDRESS as `0x${string}`,
        abi: factoryAbi,
        functionName: 'contentContracts',
        args: [contentId],
      });
      status = 'confirmed';
    }
  }

  await db.from('contract_deployments').upsert({
    content_id: contentId,
    content_contract: contentContract,
    factory: CONTENT_FACTORY_ADDRESS || null,
    tx_hash: txHash,
    status,
    raw: { metadata, usdc: USDC_ADDRESS },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'content_id' });

  return {
    content_id: contentId,
    content_contract: contentContract,
    metadata_uri: metadataUri,
    metadata_hash: metadataHash,
    tx_hash: txHash,
    status,
  };
}

export async function readContentPrice(contentContract: string, fallbackAtomic: string): Promise<string> {
  if (!ARC_RPC_URL || !CONTENT_FACTORY_ADDRESS) {
    return fallbackAtomic;
  }
  try {
    const price = await getPublicClient().readContract({
      address: contentContract as `0x${string}`,
      abi: vaultAbi,
      functionName: 'priceAtomic',
    });
    return price.toString();
  } catch {
    return fallbackAtomic;
  }
}

export async function tuneContentPrice(contentContract: string, newPriceAtomic: bigint, reasonHash: `0x${string}`): Promise<string | null> {
  const account = getTunerAccount();
  if (!ARC_RPC_URL || !account || !CONTENT_TUNER_PRIVATE_KEY) return null;
  const walletClient = createWalletClient({ account, chain: arcTestnetChain, transport: http(ARC_RPC_URL) });
  const txHash = await walletClient.writeContract({
    address: contentContract as `0x${string}`,
    abi: vaultAbi,
    functionName: 'tunePrice',
    args: [newPriceAtomic, reasonHash],
  });
  await getPublicClient().waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function readWithdrawNonce(contentContract: string): Promise<bigint> {
  return getPublicClient().readContract({
    address: contentContract as `0x${string}`,
    abi: vaultAbi,
    functionName: 'withdrawNonce',
  });
}

// Relays a creator-signed withdrawal (EIP-712 `Withdraw(address to,uint256 amountAtomic,uint256 nonce)`
// over the vault's own domain separator). The tuner key only relays here — it cannot originate an
// arbitrary destination/amount without a matching unused signature from the vault's `creator`.
export async function withdrawFromContent(
  contentContract: string,
  to: string,
  amountAtomic: bigint,
  nonce: bigint,
  signature: { v: number; r: `0x${string}`; s: `0x${string}` }
): Promise<string | null> {
  const account = getTunerAccount();
  if (!ARC_RPC_URL || !account || !CONTENT_TUNER_PRIVATE_KEY) return null;
  const walletClient = createWalletClient({ account, chain: arcTestnetChain, transport: http(ARC_RPC_URL) });
  const txHash = await walletClient.writeContract({
    address: contentContract as `0x${string}`,
    abi: vaultAbi,
    functionName: 'withdrawSigned',
    args: [to as `0x${string}`, amountAtomic, nonce, signature.v, signature.r, signature.s],
  });
  await getPublicClient().waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
