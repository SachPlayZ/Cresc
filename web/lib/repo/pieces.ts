// lib/repo/pieces.ts
import { SupabaseClient } from '@supabase/supabase-js';
import type { Piece } from './types.js';

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
