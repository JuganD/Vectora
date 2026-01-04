using Vectora.Api.Models;

namespace Vectora.Api.Repositories;

public interface IConnectionRepository
{
    Task<List<ServiceBusConnection>> GetAllAsync();
    Task<ServiceBusConnection?> GetByIdAsync(int id);
    Task<ServiceBusConnection> CreateAsync(string name, string connectionString, bool isEmulator, int? emulatorConfigId);
    Task<ServiceBusConnection?> UpdateAsync(int id, string name, string? connectionString, bool isEmulator, int? emulatorConfigId);
    Task<bool> DeleteAsync(int id);
}

