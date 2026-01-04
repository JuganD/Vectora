using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;

namespace Vectora.Api.Helpers;

public interface IServiceBusClientCache
{
    ServiceBusClient GetClient(int connectionId, string connectionString);
    ServiceBusAdministrationClient GetAdminClient(int connectionId, string connectionString);
    void InvalidateConnection(int connectionId);
}

