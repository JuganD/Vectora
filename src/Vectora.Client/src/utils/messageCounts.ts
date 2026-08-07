// The Service Bus emulator's management API never reports message counts (it omits CountDetails and
// hardcodes MessageCount to 0), so emulator counts are derived by browsing. A background sweep
// browses this many messages per entity — one peek call, because the emulator intermittently stalls
// ~12s on any single peek and the cost is per call, not per message. Keep in sync with
// EmulatorCountRefresher.PeekCap.
export const PEEK_COUNT_CAP = 100;

// A count is either a total or a floor ("at least this many", rendered "N+"). Real Service Bus
// counts are always totals; emulator counts are floors until something has seen the end of the
// entity — either the sweep, or the user paging through the messages themselves.
export interface MessageCount {
  count: number;
  isExact: boolean;
}

export const formatMessageCount = ({ count, isExact }: MessageCount) =>
  isExact ? String(count) : `${count}+`;

// Combines what the server last browsed with what the message panel has actually loaded.
//
// Loading messages is itself a count: having pulled N messages proves there are at least N, and
// reaching the end of the entity proves there are exactly N. So a loaded-derived total wins
// outright, and otherwise the larger floor wins — the counter only ever gets sharper, never vaguer.
export const mergeMessageCount = (base: MessageCount, loaded?: MessageCount): MessageCount => {
  if (!loaded) return base;
  if (loaded.isExact) return loaded;
  if (base.count > loaded.count) return base;
  return { count: loaded.count, isExact: false };
};
