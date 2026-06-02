namespace Vectora.Api.Models;

public class ServiceBusMessageDto
{
    public string MessageId { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public string? Subject { get; set; }
    public string? CorrelationId { get; set; }
    public string? ReplyTo { get; set; }
    public string? ReplyToSessionId { get; set; }
    public string? SessionId { get; set; }
    public string? To { get; set; }
    public long SequenceNumber { get; set; }
    public DateTimeOffset EnqueuedTime { get; set; }
    public DateTimeOffset? ScheduledEnqueueTime { get; set; }
    // Active, Scheduled, or Deferred. Lets the UI flag messages that are scheduled
    // for future enqueue (and therefore must be cancelled rather than received to delete).
    public string State { get; set; } = "Active";
    public TimeSpan TimeToLive { get; set; }
    // Absolute time the message TTL runs out (EnqueuedTime + TimeToLive), computed by the SDK.
    public DateTimeOffset ExpiresAt { get; set; }
    public int DeliveryCount { get; set; }
    public string? DeadLetterReason { get; set; }
    public string? DeadLetterErrorDescription { get; set; }
    // For dead-lettered messages: the entity that dead-lettered the message.
    public string? DeadLetterSource { get; set; }
    public Dictionary<string, object>? ApplicationProperties { get; set; }
}
