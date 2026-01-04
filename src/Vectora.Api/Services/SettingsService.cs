using Vectora.Api.Repositories;

namespace Vectora.Api.Services;

public class SettingsService : ISettingsService
{
    private const string BatchOperationTimeoutKey = "BatchOperationTimeoutSeconds";
    private const int DefaultBatchOperationTimeout = 60;

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
}

