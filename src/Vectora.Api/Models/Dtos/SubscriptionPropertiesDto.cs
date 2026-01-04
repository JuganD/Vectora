namespace Vectora.Api.Models;

public class SubscriptionPropertiesDto
{
    public string Name { get; set; } = string.Empty;
    public string TopicName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public TimeSpan LockDuration { get; set; }
    public int MaxDeliveryCount { get; set; }
    public bool RequiresSession { get; set; }
    public bool DeadLetteringOnMessageExpiration { get; set; }
    public string? ForwardTo { get; set; }
    public string? ForwardDeadLetteredMessagesTo { get; set; }
}
