using System.Collections.Concurrent;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;

namespace Vectora.Api.Helpers;

public class ServiceBusClientCache : IServiceBusClientCache, IAsyncDisposable
{
    private readonly ConcurrentDictionary<int, ServiceBusClient> _clients = new();
    private readonly ConcurrentDictionary<int, ServiceBusAdministrationClient> _adminClients = new();
    private readonly ConcurrentDictionary<int, string> _connectionStrings = new();
    private readonly ConcurrentDictionary<int, bool> _emulatorAdminAvailable = new();

    public ServiceBusClient GetClient(int connectionId, string connectionString)
    {
        // Check if connection string changed - if so, invalidate
        if (_connectionStrings.TryGetValue(connectionId, out var existingConnectionString) 
            && existingConnectionString != connectionString)
        {
            InvalidateConnection(connectionId);
        }

        return _clients.GetOrAdd(connectionId, _ =>
        {
            _connectionStrings[connectionId] = connectionString;
            return new ServiceBusClient(connectionString);
        });
    }

    public ServiceBusAdministrationClient GetAdminClient(int connectionId, string connectionString)
    {
        // Check if connection string changed - if so, invalidate
        if (_connectionStrings.TryGetValue(connectionId, out var existingConnectionString) 
            && existingConnectionString != connectionString)
        {
            InvalidateConnection(connectionId);
        }

        return _adminClients.GetOrAdd(connectionId, _ =>
        {
            _connectionStrings[connectionId] = connectionString;
            return new ServiceBusAdministrationClient(connectionString);
        });
    }

    public ServiceBusAdministrationClient GetEmulatorAdminClient(int connectionId, string connectionString, string adminConnectionString)
    {
        // Identity is the original connection string (same as GetClient) so the two never
        // invalidate each other; the client is built from the management-port variant.
        if (_connectionStrings.TryGetValue(connectionId, out var existingConnectionString)
            && existingConnectionString != connectionString)
        {
            InvalidateConnection(connectionId);
        }

        return _adminClients.GetOrAdd(connectionId, _ =>
        {
            _connectionStrings[connectionId] = connectionString;
            return new ServiceBusAdministrationClient(adminConnectionString);
        });
    }

    public bool? GetEmulatorAdminAvailability(int connectionId)
        => _emulatorAdminAvailable.TryGetValue(connectionId, out var available) ? available : null;

    public void SetEmulatorAdminAvailability(int connectionId, bool available)
        => _emulatorAdminAvailable[connectionId] = available;

    public void InvalidateConnection(int connectionId)
    {
        _connectionStrings.TryRemove(connectionId, out _);
        _adminClients.TryRemove(connectionId, out _);
        _emulatorAdminAvailable.TryRemove(connectionId, out _);
        
        if (_clients.TryRemove(connectionId, out var client))
        {
            // Dispose asynchronously in the background
            _ = Task.Run(async () =>
            {
                try
                {
                    await client.DisposeAsync();
                }
                catch
                {
                    // Ignore disposal errors
                }
            });
        }
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var kvp in _clients)
        {
            try
            {
                await kvp.Value.DisposeAsync();
            }
            catch
            {
                // Ignore disposal errors
            }
        }
        _clients.Clear();
        _adminClients.Clear();
        _connectionStrings.Clear();
        _emulatorAdminAvailable.Clear();
    }
}

