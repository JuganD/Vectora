namespace Vectora.Api.Models;

/// <summary>
/// Result of peeking one page of messages and grouping them by session id.
/// Peek is read-only and never locks sessions, so callers can page through a
/// queue of any depth by passing <see cref="LastSequenceNumber"/> back as the
/// next request's fromSequenceNumber.
/// </summary>
public class SessionScanResultDto
{
    /// <summary>Sessions found within the page that was scanned by this call.</summary>
    public List<SessionInfoDto> Sessions { get; set; } = [];

    /// <summary>Number of messages actually peeked during this call.</summary>
    public int ScannedCount { get; set; }

    /// <summary>Sequence number of the last message scanned; pass +1 as the next fromSequenceNumber. Null when nothing was scanned.</summary>
    public long? LastSequenceNumber { get; set; }

    /// <summary>True when the scan reached the end of the entity (no more messages to page through).</summary>
    public bool ReachedEnd { get; set; }
}
