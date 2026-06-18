-- M1: helper functions

-- Atomic revisit counter increment (avoids read-modify-write race in sessions.ts)
CREATE OR REPLACE FUNCTION increment_revisit(session_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE sessions SET revisit_count = revisit_count + 1 WHERE id = session_id;
$$;
