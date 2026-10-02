/**
 * Call window rules — keep in sync with mint_livekit_token
 * (supabase/migrations/20261205000000_call_grace_window.sql).
 *
 * A booking's call opens 5 minutes before the slot start and can still be
 * started up to CALL_GRACE_MINUTES after the slot ends (slightly-late
 * starts used to hit "Call ended" the second the slot closed).
 */
export const CALL_OPENS_BEFORE_MINUTES = 5;
export const CALL_GRACE_MINUTES = 60;
