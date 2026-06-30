namespace Vectora.Api.Services;

public interface ISettingsService
{
    Task<int> GetBatchOperationTimeoutSecondsAsync();
    Task SetBatchOperationTimeoutSecondsAsync(int value);

    // MCP server settings (server-level on/off + optional bearer key shared by all exposed connections).
    Task<bool> GetMcpEnabledAsync();
    Task SetMcpEnabledAsync(bool value);
    Task<string?> GetMcpApiKeyAsync();
    Task SetMcpApiKeyAsync(string? value);
}

