// lib/repo/notifications.ts
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { Notification } from './types';

export async function createNotification(
  db: SupabaseClient,
  input: { reader_id: string; kind: 'tip_prompt'; payload: unknown }
): Promise<Notification> {
  const { data, error } = await db.from('notifications').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function getUnreadNotifications(
  db: SupabaseClient,
  readerId: string
): Promise<Notification[]> {
  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('reader_id', readerId)
    .eq('read', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}

// Realtime subscription for tip prompts pushed to a reader (while reading page is open)
export function subscribeToNotifications(
  db: SupabaseClient,
  readerId: string,
  onNotification: (n: Notification) => void
): RealtimeChannel {
  return db
    .channel(`notifications:${readerId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `reader_id=eq.${readerId}`,
      },
      (payload) => onNotification(payload.new as Notification)
    )
    .subscribe();
}
