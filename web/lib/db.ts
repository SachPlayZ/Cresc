/**
 * lib/db.ts — Supabase client factory.
 * M0: browser anon client + server service-role client.
 * Never expose service role key to browser (NEXT_PUBLIC_* only holds anon key).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./config";

// Lazy singleton for browser client (reuse across components)
let _browserClient: SupabaseClient | null = null;

/**
 * createBrowserClient — for client components. Uses anon (publishable) key.
 * Safe to call multiple times — returns the same instance.
 */
export function createBrowserClient(): SupabaseClient {
  if (_browserClient) return _browserClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "[db] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set."
    );
  }
  _browserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _browserClient;
}

/**
 * createServerClient — for server-only code (API routes, agents, RSC).
 * Uses service role key — bypasses Row Level Security.
 * NEVER call from client components.
 */
export function createServerClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "[db] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for server client."
    );
  }
  // No singleton — server instances are request-scoped in Next.js RSC.
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
