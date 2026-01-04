using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorTopic
{
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("Properties")]
    public EmulatorTopicProperties Properties { get; set; } = new();

    [JsonPropertyName("Subscriptions")]
    public List<EmulatorSubscription> Subscriptions { get; set; } = new();
}

