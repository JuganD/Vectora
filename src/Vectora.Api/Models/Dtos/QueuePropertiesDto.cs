namespace Vectora.Api.Models;

public class QueuePropertiesDto
{
    // Configuration
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan LockDuration { get; set; }
    public TimeSpan AutoDeleteOnIdle { get; set; }
    public TimeSpan DuplicateDetectionHistoryTimeWindow { get; set; }
    public int MaxDeliveryCount { get; set; }
    public bool RequiresDuplicateDetection { get; set; }
    public bool RequiresSession { get; set; }
    public bool DeadLetteringOnMessageExpiration { get; set; }
    public bool EnableBatchedOperations { get; set; }
    public bool EnablePartitioning { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
    public long MaxSizeInMegabytes { get; set; }
    public long? MaxMessageSizeInKilobytes { get; set; }
    public string? UserMetadata { get; set; }

    // Runtime metrics (null when the runtime properties could not be read)
    public long? TotalMessageCount { get; set; }
    public long? ActiveMessageCount { get; set; }
    public long? DeadLetterMessageCount { get; set; }
    public long? ScheduledMessageCount { get; set; }
    public long? TransferMessageCount { get; set; }
    public long? TransferDeadLetterMessageCount { get; set; }
    public long? SizeInBytes { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? AccessedAt { get; set; }
}
