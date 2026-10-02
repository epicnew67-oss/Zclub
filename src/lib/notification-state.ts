export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationState = { rows: NotificationRow[]; unread: number };

/** Optimistic read and realtime echo must make the same idempotent transition. */
export function applyNotification(state: NotificationState, row: NotificationRow, inserted = false): NotificationState {
  const previous = state.rows.find(r => r.id === row.id);
  if (!previous && !inserted) return state;
  const delta = previous ? Number(!row.read_at) - Number(!previous.read_at) : Number(!row.read_at);
  return {
    rows: previous ? state.rows.map(r => r.id === row.id ? row : r) : [row, ...state.rows].slice(0, 30),
    unread: Math.max(0, state.unread + delta),
  };
}
