// lib/repo/articles.ts — Ghost-native article repo (new architecture).
import { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from './types';

export async function getArticleBySlug(
  db: SupabaseClient,
  slug: string,
  creatorId?: string
): Promise<Article | null> {
  let query = db
    .from('articles')
    .select('*, creators!inner(eoa_address, circle_wallet_id, display_name)')
    .eq('slug', slug)
    .eq('active', true);
  if (creatorId) query = query.eq('creator_id', creatorId);
  const { data, error } = await query.single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function listArticlesByCreator(
  db: SupabaseClient,
  creatorId: string
): Promise<Article[]> {
  const { data, error } = await db
    .from('articles')
    .select('*')
    .eq('creator_id', creatorId)
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function upsertGhostArticle(
  db: SupabaseClient,
  input: {
    slug: string;
    creator_id: string;
    title: string;
    excerpt: string;
    topics: string[];
    base_price_atomic: string | number | bigint;
    current_price_atomic: string | number | bigint;
    ghost_post_id: string;
    ghost_instance_url: string;
    content_id?: string | null;
    content_contract?: string | null;
    metadata_uri?: string | null;
    metadata_hash?: string | null;
    factory_tx?: string | null;
  }
): Promise<string> {
  const { data, error } = await db
    .from('articles')
    .upsert(
      { ...input, updated_at: new Date().toISOString() },
      { onConflict: 'creator_id,ghost_post_id' }
    )
    .select('slug')
    .single();
  if (error) throw error;
  return data.slug as string;
}

export async function updateArticlePrice(
  db: SupabaseClient,
  slug: string,
  currentPriceAtomic: string | bigint
): Promise<void> {
  const { error } = await db
    .from('articles')
    .update({ current_price_atomic: currentPriceAtomic, updated_at: new Date().toISOString() })
    .eq('slug', slug)
    .eq('active', true);
  if (error) throw error;
}

export async function updateArticleContract(
  db: SupabaseClient,
  slug: string,
  input: {
    content_id: string;
    content_contract: string;
    metadata_uri?: string | null;
    metadata_hash?: string | null;
    factory_tx?: string | null;
  }
): Promise<void> {
  const { error } = await db
    .from('articles')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('slug', slug)
    .eq('active', true);
  if (error) throw error;
}

export async function setArticleMonetization(
  db: SupabaseClient,
  creatorId: string,
  slug: string,
  enabled: boolean
): Promise<void> {
  const { error } = await db
    .from('articles')
    .update({ monetization_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('slug', slug)
    .eq('creator_id', creatorId);
  if (error) throw error;
}

export async function listActiveArticles(db: SupabaseClient): Promise<Article[]> {
  const { data, error } = await db
    .from('articles')
    .select('*')
    .eq('active', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
