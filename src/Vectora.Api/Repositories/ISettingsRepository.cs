namespace Vectora.Api.Repositories;

public interface ISettingsRepository
{
    Task<string?> GetValueAsync(string key);
    Task SetValueAsync(string key, string value);
    Task<int> GetIntAsync(string key, int defaultValue);
    Task SetIntAsync(string key, int value);
}

