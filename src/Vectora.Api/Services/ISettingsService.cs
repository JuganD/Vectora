namespace Vectora.Api.Services;

public interface ISettingsService
{
    Task<int> GetBatchOperationTimeoutSecondsAsync();
    Task SetBatchOperationTimeoutSecondsAsync(int value);
}

