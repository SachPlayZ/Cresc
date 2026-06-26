-- Add UCW user ID to creators for Circle user-controlled wallet identity.
ALTER TABLE creators ADD COLUMN IF NOT EXISTS ucw_user_id text;
