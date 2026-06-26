using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;

namespace Vectora.Api.Helpers;

public interface IServiceBusClientCache
{
    ServiceBusClient GetClient(int connectionId, string connectionString);
    ServiceBusAdministrationClient GetAdminClient(int connectionId, string connectionString);

    /// <summary>
    /// Admin client for an emulator connection. <paramref name="connectionString"/> is the
    /// original (data-plane) string used as the cache identity, while <paramref name="adminConnectionString"/>
    /// is the management-port variant the client is actually built from.
    /// </summary>
    ServiceBusAdministrationClient GetEmulatorAdminClient(int connectionId, string connectionString, string adminConnectionString);

    /// <summary>Cached result of probing an emulator's management port; null when not yet probed.</summary>
    bool? GetEmulatorAdminAvailability(int connectionId);
    void SetEmulatorAdminAvailability(int connectionId, bool available);

    void InvalidateConnection(int connectionId);
}

