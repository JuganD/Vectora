using Vectora.Api.Models;

namespace Vectora.Api.Services;

// Emulator message counts have to be derived by browsing (its management API always reports zero),
// and the emulator intermittently stalls ~12s on a single peek. Counting therefore happens here, off
// the request path wherever possible, and every read surface serves the last-known values instantly.
public interface IEmulatorCountRefresher
{
    // Starts (or restarts) a full count sweep for the connection's cached entities. Returns
    // immediately; a sweep already in flight for the connection is superseded.
    //
    // Only call this on an explicit entity refresh. Counting an entity competes with reads of that
    // same entity, so nothing on the entity-open path may start a sweep.
    void Trigger(ServiceBusConnection connection);

    // Counts one entity now, updating its cached DTO. Unlike Trigger this is awaited by the caller,
    // so it belongs only on a request the client fires deliberately and doesn't render against —
    // the client asks for it after its first page of messages is already on screen.
    Task CountEntityNowAsync(ServiceBusConnection connection, string entityPath, string? subscriptionName, CancellationToken cancellationToken);

    // True while a sweep is running, so the client knows the counts it just received are provisional.
    bool IsPending(int connectionId);
}
