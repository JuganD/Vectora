using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorSubscriptionProperties
{
    [JsonPropertyName("DeadLetteringOnMessageExpiration")]
    public bool DeadLetteringOnMessageExpiration { get; set; }

    [JsonPropertyName("DefaultMessageTimeToLive")]
    public string DefaultMessageTimeToLive { get; set; } = "PT1H";

    [JsonPropertyName("LockDuration")]
    public string LockDuration { get; set; } = "PT1M";

    [JsonPropertyName("MaxDeliveryCount")]
    public int MaxDeliveryCount { get; set; } = 10;

    [JsonPropertyName("RequiresSession")]
    public bool RequiresSession { get; set; }

    [JsonPropertyName("ForwardTo")]
    public string? ForwardTo { get; set; }

    [JsonPropertyName("ForwardDeadLetteredMessagesTo")]
    public string? ForwardDeadLetteredMessagesTo { get; set; }
}

