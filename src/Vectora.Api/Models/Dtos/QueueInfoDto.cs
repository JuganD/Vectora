namespace Vectora.Api.Models;

public class QueueInfoDto
{
    public string Name { get; set; } = string.Empty;
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
    public bool IsEmulator { get; set; }
    public bool RequiresSession { get; set; }

    // False when the count is a floor rather than a total — the client renders it as "N+". Only
    // emulator counts, which come from browsing a bounded number of messages, are ever inexact;
    // admin-reported counts are totals, hence the default.
    public bool ActiveCountExact { get; set; } = true;
    public bool DeadLetterCountExact { get; set; } = true;
}
