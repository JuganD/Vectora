using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorNamespace
{
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("Queues")]
    public List<EmulatorQueue> Queues { get; set; } = new();

    [JsonPropertyName("Topics")]
    public List<EmulatorTopic> Topics { get; set; } = new();
}

