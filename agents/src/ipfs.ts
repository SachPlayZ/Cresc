// src/ipfs.ts — Pins the Watcher's price-tune reasoning to IPFS via Pinata before the
// price change goes on-chain, so the on-chain reasonHash (ContentVault's PriceTuned
// event) can be independently verified against real, persisted content.

import { PINATA_JWT } from './config.js';

/**
 * Pins a JSON object to IPFS via Pinata. Returns the CID, or null if PINATA_JWT is
 * unset (graceful no-op — pricing must not block on a missing/unconfigured pinning
 * provider, same philosophy as Groq/payment mock mode).
 */
export async function pinJsonToIpfs(json: unknown, name: string): Promise<string | null> {
  if (!PINATA_JWT) return null;

  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pinataContent: json,
      pinataMetadata: { name },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[ipfs] pinJSONToIPFS failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const data = await res.json() as { IpfsHash: string };
  return data.IpfsHash;
}
