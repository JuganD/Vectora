namespace Vectora.Api.Models;

public class TopicPropertiesDto
{
    // Configuration
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan AutoDeleteOnIdle { get; set; }
    public TimeSpan DuplicateDetectionHistoryTimeWindow { get; set; }
    public bool RequiresDuplicateDetection { get; set; }
    public bool EnableBatchedOperations { get; set; }
    public bool EnablePartitioning { get; set; }
    public bool SupportOrdering { get; set; }
    public long MaxSizeInMegabytes { get; set; }
    public long? MaxMessageSizeInKilobytes { get; set; }
    public string? UserMetadata { get; set; }

    // Runtime metrics (null when the runtime properties could not be read)
    public int? SubscriptionCount { get; set; }
    public long? ScheduledMessageCount { get; set; }
    public long? SizeInBytes { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
    public DateTimeOffset? AccessedAt { get; set; }
}
