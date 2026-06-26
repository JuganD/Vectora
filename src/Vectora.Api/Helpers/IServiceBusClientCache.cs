using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;

namespace Vectora.Api.Helpers;

public interface IServiceBusClientCache
{
    ServiceBusClient GetClient(int connectionId, string connectionString);
    ServiceBusAdministrationClient GetAdminClient(int connectionId, string connectionString);

    // connectionString is the original (data-plane) string used as cache identity;
    // adminConnectionString (management port) is what the client is built from.
    ServiceBusAdministrationClient GetEmulatorAdminClient(int connectionId, string connectionString, string adminConnectionString);

    bool? GetEmulatorAdminAvailability(int connectionId);
    void SetEmulatorAdminAvailability(int connectionId, bool available);

    void InvalidateConnection(int connectionId);
}

