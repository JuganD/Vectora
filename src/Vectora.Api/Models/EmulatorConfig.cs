using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class EmulatorConfig
{
    [JsonPropertyName("UserConfig")]
    public UserConfig UserConfig { get; set; } = new();
}
