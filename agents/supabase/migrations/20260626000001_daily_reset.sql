-- Daily budget reset function.
-- Called by EC2 agent on a 24h interval (midnight UTC).
-- Resets spent_today_atomic to 0 for all readers.
-- Does NOT touch spent_session_atomic — sessions are reset separately on session start.

CREATE OR REPLACE FUNCTION reset_daily_budgets()
RETURNS void LANGUAGE sql AS $$
  UPDATE readers SET spent_today_atomic = 0 WHERE spent_today_atomic > 0;
$$;
