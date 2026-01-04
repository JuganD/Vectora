using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorQueue
{
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("Properties")]
    public EmulatorQueueProperties Properties { get; set; } = new();
}

