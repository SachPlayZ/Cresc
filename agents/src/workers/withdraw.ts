// EC2 gateway-mint worker — called by Vercel /api/withdraw/submit after creator signs BurnIntent.
// Submits attestation to GatewayMinter contract using buyer EOA (viem walletClient).
// BurnIntent signing moved to browser (UCW W3S SDK challenge via /api/withdraw/prepare).

import { createWalletClient, createPublicClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BUYER_PRIVATE_KEY,
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  GATEWAY_MINTER_ADDRESS,
} from '../config.js';

const GATEWAY_MINT_ABI = [
  {
    name: 'gatewayMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attestation', type: 'bytes' },
      { name: 'attestationSig', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const arcTestnetChain = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL || 'https://arc-testnet.drpc.org'] } },
});

export async function executeGatewayMint(
  attestation: string,
  attestationSig: string
): Promise<string> {
  if (!BUYER_PRIVATE_KEY) throw new Error('[gateway-mint] BUYER_PRIVATE_KEY required');

  const account = privateKeyToAccount(BUYER_PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnetChain,
    transport: http(ARC_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: arcTestnetChain,
    transport: http(ARC_RPC_URL),
  });

  const txHash = await walletClient.writeContract({
    address: GATEWAY_MINTER_ADDRESS as `0x${string}`,
    abi: GATEWAY_MINT_ABI,
    functionName: 'gatewayMint',
    args: [attestation as `0x${string}`, attestationSig as `0x${string}`],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}
