using Azure.Messaging.ServiceBus;
using System.Collections.Concurrent;
using Vectora.Api.Helpers;
using Vectora.Api.Models;

namespace Vectora.Api.Services;

// Singleton on purpose: sweeps outlive the request that started them, so this must never touch a
// scoped dependency (a DbContext would already be disposed). It works only from the client cache
// and the entity cache, mutating the cached DTOs in place so that a later cached read — which costs
// nothing — serves the updated counts.
public class EmulatorCountRefresher : IEmulatorCountRefresher
{
    // One page is all a sweep does. The emulator intermittently stalls ~12s on a single peek, so the
    // cost of counting is really the number of peek calls, not the number of messages: a queue is
    // browsed once and anything past this reports as "100+". The client widens that as the user
    // pages further into the entity, so a small cap here costs nothing in practice.
    public const int PeekCap = 100;
    private const int Concurrency = 8;

    private readonly IServiceBusClientCache _clientCache;
    private readonly IServiceBusEntityCache _entityCache;
    private readonly ILogger<EmulatorCountRefresher> _logger;

    private readonly ConcurrentDictionary<int, CancellationTokenSource> _sweeps = new();

    public EmulatorCountRefresher(IServiceBusClientCache clientCache, IServiceBusEntityCache entityCache, ILogger<EmulatorCountRefresher> logger)
    {
        _clientCache = clientCache;
        _entityCache = entityCache;
        _logger = logger;
    }

    public bool IsPending(int connectionId) => _sweeps.ContainsKey(connectionId);

    public void Trigger(ServiceBusConnection connection)
    {
        if (!connection.IsEmulator) return;

        var cts = new CancellationTokenSource();
        // A newer sweep supersedes the old one: the previous sweep holds references to DTOs that a
        // fresh enumeration has already replaced, so letting it continue would waste peeks writing
        // to objects nobody reads.
        if (_sweeps.TryRemove(connection.Id, out var previous))
        {
            previous.Cancel();
            previous.Dispose();
        }
        _sweeps[connection.Id] = cts;

        _ = Task.Run(async () =>
        {
            try
            {
                await SweepAsync(connection, cts.Token);
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Emulator count sweep failed for connection '{Name}' (id {Id}).", connection.Name, connection.Id);
            }
            finally
            {
                // Only clear the marker if we're still the current sweep.
                if (_sweeps.TryGetValue(connection.Id, out var current) && current == cts)
                {
                    _sweeps.TryRemove(connection.Id, out _);
                }
                cts.Dispose();
            }
        });
    }

    public async Task CountEntityNowAsync(ServiceBusConnection connection, string entityPath, string? subscriptionName, CancellationToken cancellationToken)
    {
        if (!connection.IsEmulator) return;
        if (!_entityCache.TryGet(connection.Id, out var cached)) return;

        var target = FindCounts(cached, entityPath, subscriptionName);
        if (target == null) return;

        var client = _clientCache.GetClient(connection.Id, connection.ConnectionString);
        await CountInto(client, target, entityPath, subscriptionName, cancellationToken);
    }

    private async Task SweepAsync(ServiceBusConnection connection, CancellationToken cancellationToken)
    {
        if (!_entityCache.TryGet(connection.Id, out var cached)) return;

        var client = _clientCache.GetClient(connection.Id, connection.ConnectionString);

        var work = new List<Func<Task>>();
        foreach (var queue in cached.Queues)
        {
            work.Add(() => CountInto(client, new QueueTarget(queue), queue.Name, null, cancellationToken));
        }
        foreach (var topic in cached.Topics)
        {
            foreach (var sub in topic.Subscriptions)
            {
                work.Add(() => CountInto(client, new SubscriptionTarget(sub), topic.Name, sub.Name, cancellationToken));
            }
        }

        using var throttle = new SemaphoreSlim(Concurrency);
        await Task.WhenAll(work.Select(async item =>
        {
            await throttle.WaitAsync(cancellationToken);
            try
            {
                await item();
            }
            finally
            {
                throttle.Release();
            }
        }));

        _logger.LogInformation("Emulator count sweep finished for connection '{Name}' (id {Id}): {Count} entities.", connection.Name, connection.Id, work.Count);
    }

    // The two count-carrying DTOs don't share a base type, so this bridges them.
    private interface ICountTarget
    {
        void SetActive(long count, bool exact);
        void SetDeadLetter(long count, bool exact);
    }

    private sealed class QueueTarget(QueueInfoDto dto) : ICountTarget
    {
        public void SetActive(long count, bool exact) => (dto.ActiveMessageCount, dto.ActiveCountExact) = (count, exact);
        public void SetDeadLetter(long count, bool exact) => (dto.DeadLetterMessageCount, dto.DeadLetterCountExact) = (count, exact);
    }

    private sealed class SubscriptionTarget(SubscriptionInfoDto dto) : ICountTarget
    {
        public void SetActive(long count, bool exact) => (dto.ActiveMessageCount, dto.ActiveCountExact) = (count, exact);
        public void SetDeadLetter(long count, bool exact) => (dto.DeadLetterMessageCount, dto.DeadLetterCountExact) = (count, exact);
    }

    private static ICountTarget? FindCounts((List<QueueInfoDto> Queues, List<TopicInfoDto> Topics) cached, string entityPath, string? subscriptionName)
    {
        if (subscriptionName == null)
        {
            var queue = cached.Queues.FirstOrDefault(q => q.Name == entityPath);
            return queue == null ? null : new QueueTarget(queue);
        }

        var sub = cached.Topics.FirstOrDefault(t => t.Name == entityPath)?.Subscriptions.FirstOrDefault(s => s.Name == subscriptionName);
        return sub == null ? null : new SubscriptionTarget(sub);
    }

    private async Task CountInto(ServiceBusClient client, ICountTarget target, string entityPath, string? subscriptionName, CancellationToken cancellationToken)
    {
        var active = await CountByPeekAsync(client, entityPath, subscriptionName, false, cancellationToken);
        target.SetActive(active.Count, active.Exact);

        var deadLetter = await CountByPeekAsync(client, entityPath, subscriptionName, true, cancellationToken);
        target.SetDeadLetter(deadLetter.Count, deadLetter.Exact);
    }

    private async Task<(long Count, bool Exact)> CountByPeekAsync(ServiceBusClient client, string entityPath, string? subscriptionName, bool deadLetter, CancellationToken cancellationToken)
    {
        var options = new ServiceBusReceiverOptions { SubQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None };

        try
        {
            await using var receiver = subscriptionName != null
                ? client.CreateReceiver(entityPath, subscriptionName, options)
                : client.CreateReceiver(entityPath, options);

            long count = 0, scanned = 0;
            long? nextSequenceNumber = null;
            var reachedEnd = false;

            // Bounded by messages scanned, not by matches counted: peek is best-effort and may return
            // a short page, but an entity holding nothing but scheduled messages must not send us
            // paging through all of it hunting for actives.
            while (scanned < PeekCap)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var pageSize = (int)(PeekCap - scanned);
                var batch = nextSequenceNumber.HasValue
                    ? await receiver.PeekMessagesAsync(pageSize, nextSequenceNumber.Value, cancellationToken)
                    : await receiver.PeekMessagesAsync(pageSize, cancellationToken: cancellationToken);

                if (batch.Count == 0)
                {
                    reachedEnd = true;
                    break;
                }

                // Peek also surfaces scheduled and deferred messages, which the portal's active
                // count excludes. The dead-letter subqueue has no such states, so count it whole.
                count += deadLetter
                    ? batch.Count
                    : batch.Count(m => m.State == ServiceBusMessageState.Active);

                scanned += batch.Count;
                nextSequenceNumber = batch[^1].SequenceNumber + 1;
            }

            return (count, reachedEnd);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Peek-based count failed for '{Path}'; reporting it as unknown.",
                subscriptionName == null ? entityPath : $"{entityPath}/{subscriptionName}");
            return (0, false);
        }
    }
}
