// lib/repo/pieces.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { Piece } from './types';

export async function getPiece(db: SupabaseClient, id: string): Promise<Piece | null> {
  const { data, error } = await db.from('pieces').select('*').eq('id', id).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function getStandingPrice(db: SupabaseClient, pieceId: string): Promise<string | null> {
  const { data, error } = await db
    .from('pieces')
    .select('current_price')
    .eq('id', pieceId)
    .eq('status', 'listed')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data?.current_price ?? null;
}

/**
 * Returns the standing price + the creator's wallet address for a listed piece.
 * Used by the x402 route so payments go directly to the creator, not the platform wallet.
 */
export async function getStandingPriceWithCreator(
  db: SupabaseClient,
  pieceId: string
): Promise<{ price: string; creatorWalletAddress: string } | null> {
  const { data, error } = await db
    .from('pieces')
    .select('current_price, creators!inner(wallet_address)')
    .eq('id', pieceId)
    .eq('status', 'listed')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creatorWalletAddress = (data as any).creators?.wallet_address as string | undefined;
  if (!creatorWalletAddress) return null;
  return { price: data.current_price, creatorWalletAddress };
}

export async function listPiecesByCreator(db: SupabaseClient, creatorId: string): Promise<Piece[]> {
  const { data, error } = await db
    .from('pieces')
    .select('*')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listListedPieces(db: SupabaseClient): Promise<Piece[]> {
  const { data, error } = await db
    .from('pieces')
    .select('*')
    .eq('status', 'listed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPiece(
  db: SupabaseClient,
  input: Omit<Piece, 'id' | 'created_at'>
): Promise<Piece> {
  const { data, error } = await db.from('pieces').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updatePiecePrice(
  db: SupabaseClient,
  id: string,
  newPrice: string,
  newReserve: string
): Promise<void> {
  const { error } = await db
    .from('pieces')
    .update({ current_price: newPrice, reserve: newReserve })
    .eq('id', id);
  if (error) throw error;
}

export async function updatePieceStatus(
  db: SupabaseClient,
  id: string,
  status: Piece['status']
): Promise<void> {
  const { error } = await db.from('pieces').update({ status }).eq('id', id);
  if (error) throw error;
}
