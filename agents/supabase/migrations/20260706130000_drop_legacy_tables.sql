-- Drop pre-Ghost / pre-contract-native tables and functions.
-- Superseded by: articles, readers, telemetry(_audited), payment_events,
-- price_history, withdrawals, contract_deployments (20260626000000_new_arch.sql,
-- 20260705213959_contract_native_content.sql). Confirmed zero reads/writes
-- against these in the current codebase (web/, agents/) as of this migration.
-- CASCADE drops their FKs, indexes, RLS policies, and realtime publication
-- membership; none of the live tables reference anything dropped here.

DROP TABLE IF EXISTS disputes CASCADE;
DROP TABLE IF EXISTS tip_decisions CASCADE;
DROP TABLE IF EXISTS heartbeats CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS price_decisions CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS pieces CASCADE;
DROP TABLE IF EXISTS reader_wallets CASCADE;

DROP FUNCTION IF EXISTS increment_revisit(uuid);
DROP FUNCTION IF EXISTS reset_session_budget(text);
