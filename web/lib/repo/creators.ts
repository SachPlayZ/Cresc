// lib/repo/creators.ts
import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import type { Creator } from './types';
import { GHOST_KEY_ENCRYPTION_SECRET } from '../config';

// AES-256-GCM encryption for Ghost admin keys stored at rest.
// Key = 32-byte hex from GHOST_KEY_ENCRYPTION_SECRET.
// Output format: hex(iv):hex(authTag):hex(ciphertext)
export function encryptGhostKey(plaintext: string): string {
  const key = Buffer.from(GHOST_KEY_ENCRYPTION_SECRET, 'hex');
  if (key.length !== 32) throw new Error('[creators] GHOST_KEY_ENCRYPTION_SECRET must be 32-byte hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptGhostKey(enc: string): string {
  const key = Buffer.from(GHOST_KEY_ENCRYPTION_SECRET, 'hex');
  const parts = enc.split(':');
  if (parts.length !== 3) throw new Error('[creators] invalid ghost_key_enc format');
  const [ivHex, tagHex, ctHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(ctHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

export async function getCreator(db: SupabaseClient, id: string): Promise<Creator | null> {
  const { data, error } = await db.from('creators').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function getCreatorByWallet(db: SupabaseClient, walletAddress: string): Promise<Creator | null> {
  const { data, error } = await db.from('creators').select('*').eq('wallet_address', walletAddress).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

// Always inserts a fresh row. wallet_address is nullable (partial-unique index, see
// migration 20260706120000) — pass null, not '', when the wallet isn't known yet, so
// concurrent not-yet-onboarded creators never collide on the same placeholder value.
export async function createCreator(
  db: SupabaseClient,
  input: { display_name: string; wallet_address: string | null }
): Promise<Creator> {
  const { data, error } = await db.from('creators').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateGhostConnection(
  db: SupabaseClient,
  creatorId: string,
  data: { ghost_instance_url: string; ghost_admin_key: string; ghost_webhook_secret: string }
): Promise<void> {
  const { error } = await db.from('creators').update({
    ghost_instance_url: data.ghost_instance_url,
    ghost_key_enc: encryptGhostKey(data.ghost_admin_key),
    ghost_admin_key: null,
    ghost_webhook_secret: data.ghost_webhook_secret,
  }).eq('id', creatorId);
  if (error) throw error;
}
