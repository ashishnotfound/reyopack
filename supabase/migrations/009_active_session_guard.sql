-- Ensure one active packing session per worker, even when two devices start
-- at the same time. A second device reuses the existing session through the
-- client session lookup instead of creating a competing active session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_packing_sessions_one_active_per_packer
  ON public.packing_sessions (packer_id)
  WHERE ended_at IS NULL;
