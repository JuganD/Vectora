using System.Collections.Concurrent;
using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;

namespace Vectora.Api.Helpers;

public class ServiceBusClientCache : IServiceBusClientCache, IAsyncDisposable
{
    private readonly ConcurrentDictionary<int, ServiceBusClient> _clients = new();
    private readonly ConcurrentDictionary<int, ServiceBusAdministrationClient> _adminClients = new();
    private readonly ConcurrentDictionary<int, string> _connectionStrings = new();

    // The emulator is local, so the SDK's default retry budget (4 tries with backoff) only turns a
    // stopped emulator into a ~90s hang. Fail fast instead and let the caller report it.
    private static readonly ServiceBusAdministrationClientOptions EmulatorAdminOptions = new()
    {
        Retry =
        {
            MaxRetries = 1,
            NetworkTimeout = TimeSpan.FromSeconds(5),
        },
    };

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
            return new ServiceBusAdministrationClient(adminConnectionString, EmulatorAdminOptions);
        });
    }

    public void InvalidateConnection(int connectionId)
    {
        _connectionStrings.TryRemove(connectionId, out _);
        _adminClients.TryRemove(connectionId, out _);
        
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
    }
}

