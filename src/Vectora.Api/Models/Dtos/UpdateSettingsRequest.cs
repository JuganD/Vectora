namespace Vectora.Api.Models;

public class UpdateSettingsRequest
{
    public int? BatchOperationTimeoutSeconds { get; set; }

    // MCP server settings. Null fields are left unchanged.
    public bool? McpEnabled { get; set; }
    // ****** to store. Null leaves the existing key untouched; an empty
    // string clears it (no authorization required).
    public string? McpApiKey { get; set; }

    // Tour guide: the last completed tour version the client is acknowledging.
    // Null leaves the existing value untouched.
    public int? TourGuideCompletedStep { get; set; }
}
