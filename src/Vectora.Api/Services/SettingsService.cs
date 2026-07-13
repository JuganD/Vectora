using Vectora.Api.Repositories;

namespace Vectora.Api.Services;

public class SettingsService : ISettingsService
{
    private const string BatchOperationTimeoutKey = "BatchOperationTimeoutSeconds";
    private const int DefaultBatchOperationTimeout = 60;
    private const string McpEnabledKey = "McpEnabled";
    private const string McpApiKeyKey = "McpApiKey";
    private const string TourGuideCompletedStepKey = "TourGuideCompletedStep";

    private readonly ISettingsRepository _repository;

    public SettingsService(ISettingsRepository repository)
    {
        _repository = repository;
    }

    public async Task<int> GetBatchOperationTimeoutSecondsAsync()
    {
        return await _repository.GetIntAsync(BatchOperationTimeoutKey, DefaultBatchOperationTimeout);
    }

    public async Task SetBatchOperationTimeoutSecondsAsync(int value)
    {
        var clampedValue = Math.Max(10, Math.Min(600, value));
        await _repository.SetIntAsync(BatchOperationTimeoutKey, clampedValue);
    }

    public async Task<bool> GetMcpEnabledAsync()
    {
        var value = await _repository.GetValueAsync(McpEnabledKey);
        return bool.TryParse(value, out var result) && result;
    }

    public async Task SetMcpEnabledAsync(bool value)
    {
        await _repository.SetValueAsync(McpEnabledKey, value ? "true" : "false");
    }

    public async Task<string?> GetMcpApiKeyAsync()
    {
        var value = await _repository.GetValueAsync(McpApiKeyKey);
        return string.IsNullOrEmpty(value) ? null : value;
    }

    public async Task SetMcpApiKeyAsync(string? value)
    {
        await _repository.SetValueAsync(McpApiKeyKey, value ?? string.Empty);
    }

    public async Task<int> GetTourGuideCompletedStepAsync()
    {
        return await _repository.GetIntAsync(TourGuideCompletedStepKey, 0);
    }

    public async Task SetTourGuideCompletedStepAsync(int step)
    {
        await _repository.SetIntAsync(TourGuideCompletedStepKey, step);
    }
}

