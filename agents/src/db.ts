// keep-in-sync: Cresc/lib/db.ts (server-client only; no browser client needed in agents service)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.js';

export function createServerClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('[db] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
