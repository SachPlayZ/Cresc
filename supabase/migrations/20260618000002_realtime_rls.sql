-- M1 addendum: Realtime publications + Row Level Security
-- Fixes two classes of issues:
--   1. notifications and payments were missing from supabase_realtime, so browser
--      subscriptions in notifications.ts and payments.ts never received events.
--   2. No RLS meant the anon/publishable key could read or write any table
--      directly via the Data API — bypassing all server-side validation.
--
-- Architecture note: all data mutations go through service role (API routes / agents).
-- The service role bypasses RLS by default in Supabase. The anon (browser) key
-- is used only for Realtime subscriptions and public piece listings.

-- ---------------------------------------------------------------------------
-- 1. Realtime publications: add missing tables
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE payments;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on every table in the public schema
-- ---------------------------------------------------------------------------

ALTER TABLE creators        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pieces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeats      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_decisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Anon SELECT policies (only where the browser actually needs to read)
-- ---------------------------------------------------------------------------

-- Public piece listing: reader can browse listed pieces (home page + piece page)
CREATE POLICY "pieces_anon_read_listed"
  ON pieces FOR SELECT TO anon
  USING (status = 'listed');

-- Price decisions: publicly visible so readers/creators can inspect reasoning
-- (API routes filter to the relevant piece; no per-row secret data here)
CREATE POLICY "price_decisions_anon_read"
  ON price_decisions FOR SELECT TO anon
  USING (true);

-- Notifications Realtime: anon client subscribes and receives events;
-- row-level filtering is applied by the client filter (reader_id=eq.X).
-- Without a SELECT policy here, Supabase Realtime won't deliver events to anon.
CREATE POLICY "notifications_anon_read"
  ON notifications FOR SELECT TO anon
  USING (true);

-- Payments Realtime: dashboard live feed for settled payments on a piece.
CREATE POLICY "payments_anon_read_settled"
  ON payments FOR SELECT TO anon
  USING (status = 'settled');

-- ---------------------------------------------------------------------------
-- 4. No anon write policies — all INSERT/UPDATE/DELETE requires service role
-- ---------------------------------------------------------------------------
-- (Omitting write policies = deny all for anon/authenticated roles, which is
-- the desired behaviour: all writes go through API routes using service role.)
