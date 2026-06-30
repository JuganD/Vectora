namespace Vectora.Api.Models;

public class UpdateSettingsRequest
{
    public int? BatchOperationTimeoutSeconds { get; set; }

    // MCP server settings. Null fields are left unchanged.
    public bool? McpEnabled { get; set; }
    // New bearer key to store. Null leaves the existing key untouched.
    public string? McpApiKey { get; set; }
    // When true, removes any configured key (no authorization required).
    public bool ClearMcpApiKey { get; set; }
}
