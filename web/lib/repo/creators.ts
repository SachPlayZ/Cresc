// lib/repo/creators.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { Creator } from './types.js';

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

export async function createCreator(
  db: SupabaseClient,
  input: { display_name: string; wallet_address: string }
): Promise<Creator> {
  const { data, error } = await db.from('creators').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function upsertCreator(
  db: SupabaseClient,
  input: { display_name: string; wallet_address: string }
): Promise<Creator> {
  const { data, error } = await db
    .from('creators')
    .upsert(input, { onConflict: 'wallet_address' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
