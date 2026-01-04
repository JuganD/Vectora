using Microsoft.EntityFrameworkCore;
using Vectora.Api.Data;
using Vectora.Api.Helpers;
using Vectora.Api.Models;

namespace Vectora.Api.Repositories;

public class ConnectionRepository : IConnectionRepository
{
    private readonly VectoraDbContext _db;
    private readonly IServiceBusClientCache _clientCache;

    public ConnectionRepository(VectoraDbContext db, IServiceBusClientCache clientCache)
    {
        _db = db;
        _clientCache = clientCache;
    }

    public async Task<List<ServiceBusConnection>> GetAllAsync()
    {
        return await _db.Connections
            .OrderBy(c => c.Name)
            .ToListAsync();
    }

    public async Task<ServiceBusConnection?> GetByIdAsync(int id)
    {
        return await _db.Connections.FindAsync(id);
    }

    public async Task<ServiceBusConnection> CreateAsync(string name, string connectionString, bool isEmulator, int? emulatorConfigId)
    {
        var connection = new ServiceBusConnection
        {
            Name = name,
            ConnectionString = connectionString,
            IsEmulator = isEmulator,
            EmulatorConfigId = emulatorConfigId
        };
        _db.Connections.Add(connection);
        await _db.SaveChangesAsync();
        return connection;
    }

    public async Task<ServiceBusConnection?> UpdateAsync(int id, string name, string? connectionString, bool isEmulator, int? emulatorConfigId)
    {
        var connection = await _db.Connections.FindAsync(id);
        if (connection == null)
        {
            return null;
        }

        connection.Name = name;
        if (!string.IsNullOrEmpty(connectionString))
        {
            connection.ConnectionString = connectionString;
        }
        connection.IsEmulator = isEmulator;
        connection.EmulatorConfigId = emulatorConfigId;
        connection.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        // Invalidate cached clients for this connection
        _clientCache.InvalidateConnection(id);

        return connection;
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var connection = await _db.Connections.FindAsync(id);
        if (connection == null)
        {
            return false;
        }
        _db.Connections.Remove(connection);
        await _db.SaveChangesAsync();

        // Invalidate cached clients for this connection
        _clientCache.InvalidateConnection(id);

        return true;
    }
}

