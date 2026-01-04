using Vectora.Api.Models;

namespace Vectora.Api.Services;

public interface IEmulatorConfigFileService
{
    Task<List<EmulatorConfigFile>> GetAllAsync();
    Task<EmulatorConfigFile?> GetByIdAsync(int id);
    Task<EmulatorConfigFile> CreateOrUpdateAsync(string fileName, string content);
    Task<bool> DeleteAsync(int id);
    Task<bool> IsConfigInUseAsync(int id);
}

