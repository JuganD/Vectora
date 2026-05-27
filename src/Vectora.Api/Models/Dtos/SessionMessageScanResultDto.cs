namespace Vectora.Api.Models;

/// <summary>
/// Result of peeking one page of messages and filtering it to a single session id.
/// Like <see cref="SessionScanResultDto"/> this is purely read-only (peek), and
/// pages via <see cref="LastSequenceNumber"/> so a session in a deep queue can be
/// browsed without ever holding a lock or loading the whole entity.
/// </summary>
public class SessionMessageScanResultDto
{
    /// <summary>Messages within the scanned page that belong to the requested session.</summary>
    public List<ServiceBusMessageDto> Messages { get; set; } = [];

    /// <summary>Number of messages actually peeked during this call (across all sessions).</summary>
    public int ScannedCount { get; set; }

    /// <summary>Sequence number of the last message scanned; pass +1 as the next fromSequenceNumber. Null when nothing was scanned.</summary>
    public long? LastSequenceNumber { get; set; }

    /// <summary>True when the scan reached the end of the entity.</summary>
    public bool ReachedEnd { get; set; }
}
