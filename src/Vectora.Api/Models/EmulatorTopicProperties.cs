using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorTopicProperties
{
    [JsonPropertyName("DefaultMessageTimeToLive")]
    public string DefaultMessageTimeToLive { get; set; } = "PT1H";

    [JsonPropertyName("RequiresDuplicateDetection")]
    public bool RequiresDuplicateDetection { get; set; }
}

