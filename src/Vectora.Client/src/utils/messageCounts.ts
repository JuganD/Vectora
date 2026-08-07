// The Service Bus emulator's management API never reports message counts (it omits CountDetails and
// hardcodes MessageCount to 0), so the API derives emulator counts by browsing instead, stopping
// after this many messages per entity. A count sitting on the cap therefore means "at least this
// many" and is shown as "1000+". Keep in sync with EmulatorCountPeekCap in ServiceBusService.cs.
export const PEEK_COUNT_CAP = 1000;

// Counts from real Service Bus come from the admin API and are exact, so they are never suffixed —
// a real queue holding exactly 1000 messages should read "1000", not "1000+".
export const formatMessageCount = (count: number, peekDerived: boolean) =>
  peekDerived && count >= PEEK_COUNT_CAP ? `${PEEK_COUNT_CAP}+` : String(count);
