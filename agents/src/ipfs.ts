// src/ipfs.ts — Pins the Watcher's price-tune reasoning to IPFS via Pinata before the
// price change goes on-chain, so the on-chain reasonHash (ContentVault's PriceTuned
// event) can be independently verified against real, persisted content.

import { PINATA_JWT } from './config.js';

/**
 * Pins a pre-serialized JSON string to IPFS via Pinata's pinFileToIPFS, so the exact
 * bytes pinned are the exact bytes the caller hashed (e.g. keccak256 for the on-chain
 * reasonHash commitment). pinJSONToIPFS would let Pinata re-serialize the object
 * server-side, which is not guaranteed to byte-match a local JSON.stringify — breaking
 * the on-chain commitment's verifiability. Returns the CID, or null if PINATA_JWT is
 * unset (graceful no-op — pricing must not block on a missing/unconfigured pinning
 * provider, same philosophy as Groq/payment mock mode).
 */
export async function pinJsonToIpfs(raw: string, name: string): Promise<string | null> {
  if (!PINATA_JWT) return null;

  const form = new FormData();
  form.append('file', new Blob([raw], { type: 'application/json' }), `${name}.json`);
  form.append('pinataMetadata', JSON.stringify({ name }));

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`[ipfs] pinFileToIPFS failed: ${res.status} ${txt.slice(0, 200)}`);
  }

  const data = await res.json() as { IpfsHash: string };
  return data.IpfsHash;
}
