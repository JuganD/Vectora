using System.Text.Json.Serialization;

namespace Vectora.Api.Models;

public class UserConfig
{
    [JsonPropertyName("Namespaces")]
    public List<EmulatorNamespace> Namespaces { get; set; } = new();
}

