using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorSubscription
{
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("Properties")]
    public EmulatorSubscriptionProperties Properties { get; set; } = new();
}

