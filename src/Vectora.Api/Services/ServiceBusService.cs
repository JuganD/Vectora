using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Vectora.Api.Helpers;
using Vectora.Api.Models;
using Vectora.Api.Repositories;

namespace Vectora.Api.Services;

public class ServiceBusService : IServiceBusService
{
    private readonly IConnectionRepository _connectionRepository;
    private readonly IServiceBusClientCache _clientCache;
    private readonly IServiceBusEntityCache _entityCache;
    private readonly ISettingsService _settingsService;
    private readonly ILogger<ServiceBusService> _logger;
    private readonly int _emulatorAdminPort;

    public ServiceBusService(IConnectionRepository connectionRepository, IServiceBusClientCache clientCache, IServiceBusEntityCache entityCache, ISettingsService settingsService, ILogger<ServiceBusService> logger, IConfiguration configuration)
    {
        _connectionRepository = connectionRepository;
        _clientCache = clientCache;
        _entityCache = entityCache;
        _settingsService = settingsService;
        _logger = logger;
        _emulatorAdminPort = configuration.GetValue<int?>("EmulatorAdminPort") ?? EmulatorAdmin.DefaultAdminPort;
    }

    // The administration client for entity management. Emulators are driven through the same client
    // as real Service Bus, just pointed at the management port; Vectora requires an emulator build
    // that serves the management API (Azure Service Bus Emulator with SDK >= 7.20). If it isn't
    // listening, admin calls surface the failure rather than degrading to a partial view.
    private ServiceBusAdministrationClient GetManagementClient(ServiceBusConnection connection)
    {
        if (!connection.IsEmulator)
        {
            return _clientCache.GetAdminClient(connection.Id, connection.ConnectionString);
        }

        var adminConnectionString = EmulatorAdmin.BuildAdminConnectionString(connection.ConnectionString, _emulatorAdminPort);
        return _clientCache.GetEmulatorAdminClient(connection.Id, connection.ConnectionString, adminConnectionString);
    }

    public async Task<(List<QueueInfoDto> Queues, List<TopicInfoDto> Topics)?> GetEntitiesAsync(int connectionId, bool refreshCache = false, CancellationToken cancellationToken = default)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        if (!refreshCache && _entityCache.TryGet(connectionId, out var cached))
        {
            return (cached.Queues, cached.Topics);
        }

        var queues = new List<QueueInfoDto>();
        var topics = new List<TopicInfoDto>();

        await PopulateFromAdminAsync(GetManagementClient(connection), connection, queues, topics, cancellationToken);

        // The emulator enumerates entities correctly but reports every message count as zero, so
        // its counts are the one thing that still has to be derived by browsing.
        if (connection.IsEmulator)
        {
            await FillEmulatorCountsAsync(connection, queues, topics, cancellationToken);
        }

        var orderedQueues = queues.OrderBy(q => q.Name).ToList();
        var orderedTopics = topics.OrderBy(t => t.Name).ToList();
        _entityCache.Set(connectionId, orderedQueues, orderedTopics);
        return (orderedQueues, orderedTopics);
    }

    // Enumerate entities and message counts through the administration client. Counts are accurate
    // for real Service Bus; the emulator returns zeros, which FillEmulatorCountsAsync replaces.
    private static async Task PopulateFromAdminAsync(ServiceBusAdministrationClient adminClient, ServiceBusConnection connection, List<QueueInfoDto> queues, List<TopicInfoDto> topics, CancellationToken cancellationToken)
    {
        // RequiresSession lives on the entity properties (not the runtime properties that
        // carry message counts), so we pull both and merge by name.
        var sessionByQueue = new Dictionary<string, bool>();
        await foreach (var queue in adminClient.GetQueuesAsync(cancellationToken))
        {
            sessionByQueue[queue.Name] = queue.RequiresSession;
        }

        await foreach (var queue in adminClient.GetQueuesRuntimePropertiesAsync(cancellationToken))
        {
            queues.Add(new QueueInfoDto { Name = queue.Name, ActiveMessageCount = queue.ActiveMessageCount, DeadLetterMessageCount = queue.DeadLetterMessageCount, IsEmulator = connection.IsEmulator, RequiresSession = sessionByQueue.GetValueOrDefault(queue.Name) });
        }

        await foreach (var topic in adminClient.GetTopicsAsync(cancellationToken))
        {
            var sessionBySubscription = new Dictionary<string, bool>();
            await foreach (var sub in adminClient.GetSubscriptionsAsync(topic.Name, cancellationToken))
            {
                sessionBySubscription[sub.SubscriptionName] = sub.RequiresSession;
            }

            var subs = new List<SubscriptionInfoDto>();
            await foreach (var sub in adminClient.GetSubscriptionsRuntimePropertiesAsync(topic.Name, cancellationToken))
            {
                subs.Add(new SubscriptionInfoDto { Name = sub.SubscriptionName, ActiveMessageCount = sub.ActiveMessageCount, DeadLetterMessageCount = sub.DeadLetterMessageCount, RequiresSession = sessionBySubscription.GetValueOrDefault(sub.SubscriptionName) });
            }
            topics.Add(new TopicInfoDto { Name = topic.Name, Subscriptions = subs, IsEmulator = connection.IsEmulator });
        }
    }

    // Replaces the emulator's always-zero runtime counts with peek-derived ones. See
    // CountByPeekAsync for why this is necessary and what it costs.
    private async Task FillEmulatorCountsAsync(ServiceBusConnection connection, List<QueueInfoDto> queues, List<TopicInfoDto> topics, CancellationToken cancellationToken)
    {
        var client = _clientCache.GetClient(connection.Id, connection.ConnectionString);

        var work = new List<Func<Task>>();
        foreach (var queue in queues)
        {
            work.Add(async () => queue.ActiveMessageCount = await CountByPeekAsync(client, queue.Name, null, false, cancellationToken));
            work.Add(async () => queue.DeadLetterMessageCount = await CountByPeekAsync(client, queue.Name, null, true, cancellationToken));
        }
        foreach (var topic in topics)
        {
            foreach (var sub in topic.Subscriptions)
            {
                work.Add(async () => sub.ActiveMessageCount = await CountByPeekAsync(client, topic.Name, sub.Name, false, cancellationToken));
                work.Add(async () => sub.DeadLetterMessageCount = await CountByPeekAsync(client, topic.Name, sub.Name, true, cancellationToken));
            }
        }

        using var throttle = new SemaphoreSlim(EmulatorCountConcurrency);
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
    }

    public async Task<QueueInfoDto?> GetQueueRuntimeInfoAsync(int connectionId, string queueName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        // The emulator reports zero through the management API, so derive the counts by peeking.
        // This needs no admin API, so it also works for emulators without a reachable one.
        if (connection.IsEmulator)
        {
            var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
            return new QueueInfoDto
            {
                Name = queueName,
                ActiveMessageCount = await CountByPeekAsync(client, queueName, null, false, CancellationToken.None),
                DeadLetterMessageCount = await CountByPeekAsync(client, queueName, null, true, CancellationToken.None),
                IsEmulator = true
            };
        }

        var adminClient = GetManagementClient(connection);
        try
        {
            var props = await adminClient.GetQueueRuntimePropertiesAsync(queueName);
            return new QueueInfoDto
            {
                Name = props.Value.Name,
                ActiveMessageCount = props.Value.ActiveMessageCount,
                DeadLetterMessageCount = props.Value.DeadLetterMessageCount,
                IsEmulator = connection.IsEmulator
            };
        }
        catch
        {
            return null;
        }
    }

    public async Task<SubscriptionInfoDto?> GetSubscriptionRuntimeInfoAsync(int connectionId, string topicName, string subscriptionName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        // Same emulator limitation as GetQueueRuntimeInfoAsync: counts come from peeking.
        if (connection.IsEmulator)
        {
            var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
            return new SubscriptionInfoDto
            {
                Name = subscriptionName,
                ActiveMessageCount = await CountByPeekAsync(client, topicName, subscriptionName, false, CancellationToken.None),
                DeadLetterMessageCount = await CountByPeekAsync(client, topicName, subscriptionName, true, CancellationToken.None)
            };
        }

        var adminClient = GetManagementClient(connection);
        try
        {
            var props = await adminClient.GetSubscriptionRuntimePropertiesAsync(topicName, subscriptionName);
            return new SubscriptionInfoDto
            {
                Name = props.Value.SubscriptionName,
                ActiveMessageCount = props.Value.ActiveMessageCount,
                DeadLetterMessageCount = props.Value.DeadLetterMessageCount
            };
        }
        catch
        {
            return null;
        }
    }

    public async Task<List<ServiceBusMessageDto>?> PeekMessagesAsync(int connectionId, string entityPath, string? subscriptionName, int maxMessages, bool deadLetter, long? fromSequenceNumber = null)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        ServiceBusReceiver receiver;

        if (subscriptionName != null)
        {
            receiver = client.CreateReceiver(entityPath, subscriptionName, new ServiceBusReceiverOptions { SubQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None });
        }
        else
        {
            receiver = client.CreateReceiver(entityPath, new ServiceBusReceiverOptions { SubQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None });
        }

        await using (receiver)
        {
            // PeekMessagesAsync is best-effort and may return fewer messages than requested
            // Loop until we get maxMessages or no more messages are available
            var allMessages = new List<ServiceBusReceivedMessage>();
            long? nextSequenceNumber = fromSequenceNumber;

            while (allMessages.Count < maxMessages)
            {
                var batch = nextSequenceNumber.HasValue
                    ? await receiver.PeekMessagesAsync(maxMessages - allMessages.Count, nextSequenceNumber.Value)
                    : await receiver.PeekMessagesAsync(maxMessages - allMessages.Count);

                if (batch.Count == 0)
                {
                    break;
                }

                allMessages.AddRange(batch);
                nextSequenceNumber = batch[batch.Count - 1].SequenceNumber + 1;
            }

            return allMessages.OrderBy(m => m.SequenceNumber).Select(MapToDto).ToList();
        }
    }

    public async Task<SessionScanResultDto?> ScanSessionsAsync(int connectionId, string entityPath, string? subscriptionName, bool deadLetter, long? fromSequenceNumber, int scanLimit)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        await using var receiver = CreateBrowseReceiver(client, entityPath, subscriptionName, deadLetter);

        // Peek (read-only browse) one page of up to scanLimit messages and group them by
        // session id. Peek never locks a session, so this is safe against live consumers.
        var groups = new Dictionary<string, SessionInfoDto>(StringComparer.Ordinal);
        var scanned = 0;
        long? lastSequenceNumber = null;
        long? nextSequenceNumber = fromSequenceNumber;
        var reachedEnd = false;

        while (scanned < scanLimit)
        {
            var batch = nextSequenceNumber.HasValue
                ? await receiver.PeekMessagesAsync(scanLimit - scanned, nextSequenceNumber.Value)
                : await receiver.PeekMessagesAsync(scanLimit - scanned);

            // Peek is best-effort; only an empty batch means there is nothing more to page through.
            if (batch.Count == 0)
            {
                reachedEnd = true;
                break;
            }

            foreach (var msg in batch)
            {
                var sessionId = msg.SessionId ?? string.Empty;
                if (!groups.TryGetValue(sessionId, out var info))
                {
                    info = new SessionInfoDto { SessionId = sessionId };
                    groups[sessionId] = info;
                }
                info.MessageCount++;
                if (!info.LastEnqueuedTime.HasValue || msg.EnqueuedTime > info.LastEnqueuedTime.Value)
                {
                    info.LastEnqueuedTime = msg.EnqueuedTime;
                }
            }

            scanned += batch.Count;
            lastSequenceNumber = batch[batch.Count - 1].SequenceNumber;
            nextSequenceNumber = lastSequenceNumber + 1;
        }

        return new SessionScanResultDto
        {
            Sessions = groups.Values.OrderBy(s => s.SessionId, StringComparer.Ordinal).ToList(),
            ScannedCount = scanned,
            LastSequenceNumber = lastSequenceNumber,
            ReachedEnd = reachedEnd
        };
    }

    public async Task<SessionMessageScanResultDto?> PeekSessionMessagesAsync(int connectionId, string entityPath, string? subscriptionName, string sessionId, bool deadLetter, long? fromSequenceNumber, int scanLimit)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        await using var receiver = CreateBrowseReceiver(client, entityPath, subscriptionName, deadLetter);

        // Peek one page and keep only the messages for the requested session. Filtering a
        // peeked window (rather than accepting a session receiver) keeps this fully read-only.
        var matches = new List<ServiceBusMessageDto>();
        var scanned = 0;
        long? lastSequenceNumber = null;
        long? nextSequenceNumber = fromSequenceNumber;
        var reachedEnd = false;

        while (scanned < scanLimit)
        {
            var batch = nextSequenceNumber.HasValue
                ? await receiver.PeekMessagesAsync(scanLimit - scanned, nextSequenceNumber.Value)
                : await receiver.PeekMessagesAsync(scanLimit - scanned);

            if (batch.Count == 0)
            {
                reachedEnd = true;
                break;
            }

            foreach (var msg in batch)
            {
                if (string.Equals(msg.SessionId ?? string.Empty, sessionId, StringComparison.Ordinal))
                {
                    matches.Add(MapToDto(msg));
                }
            }

            scanned += batch.Count;
            lastSequenceNumber = batch[batch.Count - 1].SequenceNumber;
            nextSequenceNumber = lastSequenceNumber + 1;
        }

        return new SessionMessageScanResultDto
        {
            Messages = matches,
            ScannedCount = scanned,
            LastSequenceNumber = lastSequenceNumber,
            ReachedEnd = reachedEnd
        };
    }

    // Bulk consume/purge: removes up to maxMessages from the front of the entity (oldest first).
    // Returns the exact number of messages actually completed (deleted), or null if the connection
    // is unknown. Guarantees it never deletes more than requested:
    //   * Each batch requests exactly the outstanding remainder and is completed atomically; the
    //     cancellation token (RequestAborted) is only checked *between* batches, so a client
    //     disconnect stops further deletion without half-finishing a batch or overshooting.
    //   * Messages whose lock is lost mid-complete are not counted and are retried on a later pass.
    public async Task<int?> ReceiveMessagesAsync(int connectionId, string entityPath, string? subscriptionName, int maxMessages, bool deadLetter, CancellationToken cancellationToken = default)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var subQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None;
        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        // PrefetchCount = 0 so the broker never hands us more than we ask for; prefetched-but-unwanted
        // messages would otherwise have their locks expire and skew the count.
        var receiverOptions = new ServiceBusReceiverOptions { SubQueue = subQueue, PrefetchCount = 0 };
        ServiceBusReceiver receiver = subscriptionName != null
            ? client.CreateReceiver(entityPath, subscriptionName, receiverOptions)
            : client.CreateReceiver(entityPath, receiverOptions);

        await using (receiver)
        {
            var consumed = 0;
            var remaining = maxMessages;
            var timeoutSeconds = await _settingsService.GetBatchOperationTimeoutSecondsAsync();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(timeoutSeconds);

            while (remaining > 0 && DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
            {
                var batchSize = Math.Min(remaining, 256);
                IReadOnlyList<ServiceBusReceivedMessage> messages;
                try
                {
                    // Receive from the front of the entity (FIFO by sequence number): the "first N".
                    messages = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(5), cancellationToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Consume is best-effort: if another consumer contends the entity and the receive
                    // itself fails (link detached, transient AMQP error, etc.), stop and return what we
                    // already consumed rather than surfacing an error for the whole operation.
                    _logger.LogWarning(ex, "Receive failed while consuming from {Entity}; returning {Consumed} consumed so far", entityPath, consumed);
                    break;
                }

                if (messages.Count == 0)
                    break;

                // Complete the batch in parallel - a 200-message consume is ~1 round-trip instead of
                // 200 sequential ones, so it finishes fast enough not to trip a client/proxy timeout.
                // Count only messages that actually completed; anything that fails (lock lost because
                // another consumer grabbed it, already settled, etc.) is skipped best-effort.
                var completeResults = await Task.WhenAll(messages.Select(async msg =>
                {
                    try
                    {
                        await receiver.CompleteMessageAsync(msg, cancellationToken);
                        return true;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        return false;
                    }
                }));

                consumed += completeResults.Count(ok => ok);
                remaining = maxMessages - consumed;
            }

            return consumed;
        }
    }

    public async Task<int?> ReceiveMessagesBySequenceAsync(int connectionId, string entityPath, string? subscriptionName, IEnumerable<long> sequenceNumbers, bool deadLetter, CancellationToken cancellationToken = default)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var sequenceSet = new HashSet<long>(sequenceNumbers);
        if (sequenceSet.Count == 0)
        {
            return 0;
        }

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        var receiverOptions = new ServiceBusReceiverOptions { SubQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None, PrefetchCount = 0 };
        ServiceBusReceiver receiver = subscriptionName != null
            ? client.CreateReceiver(entityPath, subscriptionName, receiverOptions)
            : client.CreateReceiver(entityPath, receiverOptions);

        await using (receiver)
        {
            const int batchSize = 256;
            var completed = 0;
            var timeoutSeconds = await _settingsService.GetBatchOperationTimeoutSecondsAsync();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(timeoutSeconds);

            while (sequenceSet.Count > 0 && DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
            {
                IReadOnlyList<ServiceBusReceivedMessage> received;
                try
                {
                    received = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(1), cancellationToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Best-effort: if another consumer contends the entity and the receive fails, stop
                    // and return what we already completed rather than failing the whole operation.
                    _logger.LogWarning(ex, "Receive failed while deleting by sequence from {Entity}; returning {Completed} completed so far", entityPath, completed);
                    break;
                }

                if (received.Count == 0)
                {
                    break;
                }

                var toComplete = new List<ServiceBusReceivedMessage>();
                var toAbandon = new List<ServiceBusReceivedMessage>();

                foreach (var msg in received)
                {
                    if (sequenceSet.Contains(msg.SequenceNumber))
                    {
                        toComplete.Add(msg);
                        sequenceSet.Remove(msg.SequenceNumber);
                    }
                    else
                    {
                        toAbandon.Add(msg);
                    }
                }

                // Complete and abandon in parallel for speed. Both are best-effort: a message whose lock
                // was lost to another consumer (or already settled) is skipped rather than aborting the
                // batch. Count only messages that actually completed.
                var completeResults = await Task.WhenAll(toComplete.Select(async m =>
                {
                    try
                    {
                        await receiver.CompleteMessageAsync(m, cancellationToken);
                        return true;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        return false;
                    }
                }));

                await Task.WhenAll(toAbandon.Select(async m =>
                {
                    try
                    {
                        await receiver.AbandonMessageAsync(m, cancellationToken: cancellationToken);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        // Abandoning a lock we no longer hold is harmless; ignore.
                    }
                }));

                completed += completeResults.Count(ok => ok);
            }
            return completed;
        }
    }

    public async Task<int?> CancelScheduledMessagesAsync(int connectionId, string entityPath, IEnumerable<long> sequenceNumbers)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var sequences = sequenceNumbers.Distinct().ToList();
        if (sequences.Count == 0)
        {
            return 0;
        }

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        await using var sender = client.CreateSender(entityPath);

        // Cancelling a scheduled message removes it before its enqueue time. Each cancel is
        // independent; tolerate individual failures (e.g. a message that already fired) so one
        // bad sequence number doesn't abort the whole batch.
        var cancelled = 0;
        foreach (var sequenceNumber in sequences)
        {
            try
            {
                await sender.CancelScheduledMessageAsync(sequenceNumber);
                cancelled++;
            }
            catch (ServiceBusException)
            {
                // Message no longer schedulable (already enqueued or cancelled) — skip it.
            }
        }
        return cancelled;
    }

    public async Task<bool> SendMessageAsync(int connectionId, string entityPath, SendMessageDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        await using var sender = client.CreateSender(entityPath);
        var message = CreateServiceBusMessage(dto);
        await sender.SendMessageAsync(message);
        return true;
    }

    // Sends `count` identical copies of the message, packed into as few AMQP transfers as
    // possible via ServiceBusMessageBatch. Returns the number of messages sent, or null when
    // the connection is unknown.
    public async Task<int?> SendMessagesAsync(int connectionId, string entityPath, SendMessageDto dto, int count)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        await using var sender = client.CreateSender(entityPath);

        var sent = 0;
        while (sent < count)
        {
            using var batch = await sender.CreateMessageBatchAsync();
            // Always place at least one message in the batch; if a single message doesn't fit,
            // fall back to sending it on its own so we never loop forever.
            if (!batch.TryAddMessage(CreateServiceBusMessage(dto)))
            {
                await sender.SendMessageAsync(CreateServiceBusMessage(dto));
                sent++;
                continue;
            }
            var batchCount = 1;
            while (sent + batchCount < count && batch.TryAddMessage(CreateServiceBusMessage(dto)))
            {
                batchCount++;
            }
            await sender.SendMessagesAsync(batch);
            sent += batchCount;
        }
        return sent;
    }

    private static ServiceBusMessage CreateServiceBusMessage(SendMessageDto dto)
    {
        var message = new ServiceBusMessage(dto.Body)
        {
            ContentType = dto.ContentType ?? "application/json"
        };
        if (!string.IsNullOrEmpty(dto.Subject))
        {
            message.Subject = dto.Subject;
        }
        if (!string.IsNullOrEmpty(dto.MessageId))
        {
            message.MessageId = dto.MessageId;
        }
        if (!string.IsNullOrEmpty(dto.CorrelationId))
        {
            message.CorrelationId = dto.CorrelationId;
        }
        if (!string.IsNullOrEmpty(dto.ReplyTo))
        {
            message.ReplyTo = dto.ReplyTo;
        }
        if (!string.IsNullOrEmpty(dto.ReplyToSessionId))
        {
            message.ReplyToSessionId = dto.ReplyToSessionId;
        }
        if (!string.IsNullOrEmpty(dto.SessionId))
        {
            message.SessionId = dto.SessionId;
        }
        if (!string.IsNullOrEmpty(dto.To))
        {
            message.To = dto.To;
        }
        if (dto.ScheduledEnqueueTime.HasValue)
        {
            message.ScheduledEnqueueTime = dto.ScheduledEnqueueTime.Value;
        }
        if (dto.TimeToLive.HasValue)
        {
            message.TimeToLive = dto.TimeToLive.Value;
        }
        if (dto.ApplicationProperties != null)
        {
            var (valid, error) = ApplicationPropertyConverter.TryConvertAll(dto.ApplicationProperties, out var converted);
            if (!valid)
            {
                throw new ArgumentException(error);
            }
            foreach (var kvp in converted!)
            {
                message.ApplicationProperties[kvp.Key] = kvp.Value;
            }
        }
        return message;
    }

    private static ServiceBusMessageDto MapToDto(ServiceBusReceivedMessage msg)
    {
        return new ServiceBusMessageDto
        {
            MessageId = msg.MessageId,
            Body = msg.Body.ToString(),
            ContentType = msg.ContentType,
            Subject = msg.Subject,
            CorrelationId = msg.CorrelationId,
            ReplyTo = msg.ReplyTo,
            ReplyToSessionId = msg.ReplyToSessionId,
            SessionId = msg.SessionId,
            To = msg.To,
            SequenceNumber = msg.SequenceNumber,
            EnqueuedTime = msg.EnqueuedTime,
            // Non-scheduled messages report a sentinel rather than null — real Service Bus uses
            // DateTimeOffset.MinValue (year 0001), the emulator uses the Unix epoch (1970). Treat
            // anything at or before the epoch as "not scheduled" so the UI shows no bogus schedule.
            ScheduledEnqueueTime = msg.ScheduledEnqueueTime > DateTimeOffset.UnixEpoch ? msg.ScheduledEnqueueTime : null,
            State = msg.State.ToString(),
            TimeToLive = msg.TimeToLive,
            ExpiresAt = msg.ExpiresAt,
            DeliveryCount = msg.DeliveryCount,
            DeadLetterReason = msg.DeadLetterReason,
            DeadLetterErrorDescription = msg.DeadLetterErrorDescription,
            DeadLetterSource = msg.DeadLetterSource,
            ApplicationProperties = msg.ApplicationProperties.ToDictionary(k => k.Key, v => v.Value),
            ApplicationPropertyTypes = msg.ApplicationProperties.ToDictionary(k => k.Key, v => ApplicationPropertyConverter.TypeNameOf(v.Value))
        };
    }

    private static ServiceBusReceiver CreateBrowseReceiver(ServiceBusClient client, string entityPath, string? subscriptionName, bool deadLetter)
    {
        var options = new ServiceBusReceiverOptions { SubQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None };
        return subscriptionName != null
            ? client.CreateReceiver(entityPath, subscriptionName, options)
            : client.CreateReceiver(entityPath, options);
    }

    // The emulator's management API does not track message counts: its QueueDescription /
    // SubscriptionDescription omit CountDetails entirely and hardcode MessageCount to 0, so
    // GetQueuesRuntimePropertiesAsync always reports zero even when the entity holds messages.
    // Counts therefore have to be derived by browsing. Peek never locks or consumes, so this is
    // safe, but it is O(messages) — hence the cap. Browsing stops once either the counted total or
    // the number of messages scanned reaches the cap, and the result is flagged Capped so callers
    // can render it as "1000+". Reaching the cap is reported as capped even if the entity happens
    // to hold exactly the cap: confirming that would cost another round trip for no real benefit.
    private const int EmulatorCountPeekCap = 1000;
    private const int EmulatorCountPeekPageSize = 250;

    // Max entities counted concurrently. The cached ServiceBusClient multiplexes links over one
    // connection, so this only bounds how many peek loops are in flight at once.
    private const int EmulatorCountConcurrency = 8;

    // Counts messages by peeking, up to EmulatorCountPeekCap. Returns 0 if browsing fails so a
    // single unreadable entity can't take down the whole entity listing. A count that reaches the
    // cap is the client's cue to render "N+" — keep EmulatorCountPeekCap in sync with the
    // PEEK_COUNT_CAP constant in the client's EntityBrowser.
    private async Task<long> CountByPeekAsync(ServiceBusClient client, string entityPath, string? subscriptionName, bool deadLetter, CancellationToken cancellationToken)
    {
        try
        {
            await using var receiver = CreateBrowseReceiver(client, entityPath, subscriptionName, deadLetter);

            long count = 0;
            long? nextSequenceNumber = null;

            // Bounded by the count rather than by messages scanned, so that reaching the cap is
            // exactly what "there may be more" means — that equivalence is what lets the client
            // decide to render "N+" from the number alone.
            while (count < EmulatorCountPeekCap)
            {
                var pageSize = (int)Math.Min(EmulatorCountPeekPageSize, EmulatorCountPeekCap - count);
                var batch = nextSequenceNumber.HasValue
                    ? await receiver.PeekMessagesAsync(pageSize, nextSequenceNumber.Value, cancellationToken)
                    : await receiver.PeekMessagesAsync(pageSize, cancellationToken: cancellationToken);

                if (batch.Count == 0) break;

                // Peek also surfaces scheduled and deferred messages, which the portal's active
                // count excludes. The dead-letter subqueue has no such states, so count it whole.
                count += deadLetter
                    ? batch.Count
                    : batch.Count(m => m.State == ServiceBusMessageState.Active);

                nextSequenceNumber = batch[^1].SequenceNumber + 1;
            }

            return count;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Peek-based count failed for '{Path}'; reporting 0.", GetReceiverPath(entityPath, subscriptionName, deadLetter));
            return 0;
        }
    }

    // Peek-derived equivalent of the runtime message counts, for the emulator. Active/scheduled/
    // deferred come from one browse of the entity (classified by message state) and the dead-letter
    // count from a browse of its subqueue. Transfer counts have no browsable representation, so
    // they stay 0 — they only ever apply to in-flight forwarding, which the emulator doesn't do.
    private async Task<(long Active, long Scheduled, long DeadLetter, long Total)> CountByPeekBreakdownAsync(
        ServiceBusClient client, string entityPath, string? subscriptionName, CancellationToken cancellationToken)
    {
        long active = 0, scheduled = 0, other = 0;

        try
        {
            await using var receiver = CreateBrowseReceiver(client, entityPath, subscriptionName, false);

            long scanned = 0;
            long? nextSequenceNumber = null;

            while (scanned < EmulatorCountPeekCap)
            {
                var pageSize = (int)Math.Min(EmulatorCountPeekPageSize, EmulatorCountPeekCap - scanned);
                var batch = nextSequenceNumber.HasValue
                    ? await receiver.PeekMessagesAsync(pageSize, nextSequenceNumber.Value, cancellationToken)
                    : await receiver.PeekMessagesAsync(pageSize, cancellationToken: cancellationToken);

                if (batch.Count == 0) break;

                foreach (var message in batch)
                {
                    if (message.State == ServiceBusMessageState.Active) active++;
                    else if (message.State == ServiceBusMessageState.Scheduled) scheduled++;
                    else other++;
                }

                scanned += batch.Count;
                nextSequenceNumber = batch[^1].SequenceNumber + 1;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Peek-based count failed for '{Path}'; reporting 0.", GetReceiverPath(entityPath, subscriptionName, false));
        }

        var deadLetter = await CountByPeekAsync(client, entityPath, subscriptionName, true, cancellationToken);
        return (active, scheduled, deadLetter, active + scheduled + other + deadLetter);
    }

    private static string GetReceiverPath(string entityPath, string? subscriptionName, bool deadLetter)
    {
        if (subscriptionName != null)
        {
            return $"{entityPath}/Subscriptions/{subscriptionName}" + (deadLetter ? "/$deadletterqueue" : "");
        }
        return entityPath + (deadLetter ? "/$deadletterqueue" : "");
    }

    public async Task<bool?> ReturnDeadLetterMessageAsync(int connectionId, string entityPath, string? subscriptionName, long sequenceNumber, SendMessageDto? modifiedMessage, bool deleteOriginal)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        ServiceBusReceiver dlqReceiver;

        if (subscriptionName != null)
        {
            dlqReceiver = client.CreateReceiver(entityPath, subscriptionName, new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter, PrefetchCount = 0 });
        }
        else
        {
            dlqReceiver = client.CreateReceiver(entityPath, new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter, PrefetchCount = 0 });
        }

        await using (dlqReceiver)
        {
            var message = await dlqReceiver.PeekMessageAsync(sequenceNumber);
            if (message == null)
            {
                return false;
            }

            await using var sender = client.CreateSender(entityPath);
            if (modifiedMessage != null)
            {
                await sender.SendMessageAsync(CreateServiceBusMessage(modifiedMessage));
            }
            else
            {
                var newMessage = new ServiceBusMessage(message);
                await sender.SendMessageAsync(newMessage);
            }

            if (deleteOriginal)
            {
                // Use larger batch sizes for faster iteration through DLQ
                // Max batch size is 256 for Service Bus
                const int batchSize = 256;
                var maxAttempts = 50; // More attempts to handle deep messages

                for (var attempt = 0; attempt < maxAttempts; attempt++)
                {
                    var received = await dlqReceiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(1));
                    if (received.Count == 0)
                    {
                        break;
                    }

                    ServiceBusReceivedMessage? toComplete = null;
                    var toAbandon = new List<ServiceBusReceivedMessage>();

                    foreach (var msg in received)
                    {
                        if (msg.SequenceNumber == sequenceNumber)
                        {
                            toComplete = msg;
                        }
                        else
                        {
                            toAbandon.Add(msg);
                        }
                    }

                    // Abandon non-target messages in parallel for speed
                    if (toAbandon.Count > 0)
                    {
                        await Task.WhenAll(toAbandon.Select(m => dlqReceiver.AbandonMessageAsync(m)));
                    }

                    if (toComplete != null)
                    {
                        await dlqReceiver.CompleteMessageAsync(toComplete);
                        return true;
                    }
                }
            }
            return true;
        }
    }

    public async Task<int?> ReturnDeadLetterMessagesAsync(int connectionId, string entityPath, string? subscriptionName, IEnumerable<long> sequenceNumbers)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var sequenceSet = new HashSet<long>(sequenceNumbers);
        if (sequenceSet.Count == 0)
        {
            return 0;
        }

        var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
        ServiceBusReceiver dlqReceiver;

        if (subscriptionName != null)
        {
            dlqReceiver = client.CreateReceiver(entityPath, subscriptionName, new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter, PrefetchCount = 0 });
        }
        else
        {
            dlqReceiver = client.CreateReceiver(entityPath, new ServiceBusReceiverOptions { SubQueue = SubQueue.DeadLetter, PrefetchCount = 0 });
        }

        await using (dlqReceiver)
        {
            await using var sender = client.CreateSender(entityPath);

            // Peek all the messages we need to return in parallel
            var peekTasks = sequenceSet.Select(async seqNum =>
            {
                var peeked = await dlqReceiver.PeekMessageAsync(seqNum);
                return peeked != null ? (SeqNum: seqNum, Message: new ServiceBusMessage(peeked)) : ((long SeqNum, ServiceBusMessage Message)?)(null);
            });
            var peekResults = await Task.WhenAll(peekTasks);
            var messagesToReturn = peekResults
                .Where(r => r.HasValue)
                .ToDictionary(r => r!.Value.SeqNum, r => r!.Value.Message);

            // Send all messages back to the main queue in parallel
            await Task.WhenAll(messagesToReturn.Values.Select(msg => sender.SendMessageAsync(msg)));

            // Now receive and complete the original DLQ messages
            // Use larger batch sizes for faster iteration
            const int batchSize = 256;
            var completed = 0;
            var timeoutSeconds = await _settingsService.GetBatchOperationTimeoutSecondsAsync();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(timeoutSeconds);

            while (sequenceSet.Count > 0 && DateTime.UtcNow < deadline)
            {
                var received = await dlqReceiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(1));
                if (received.Count == 0)
                {
                    break;
                }

                var toComplete = new List<ServiceBusReceivedMessage>();
                var toAbandon = new List<ServiceBusReceivedMessage>();

                foreach (var msg in received)
                {
                    if (sequenceSet.Contains(msg.SequenceNumber))
                    {
                        toComplete.Add(msg);
                        sequenceSet.Remove(msg.SequenceNumber);
                    }
                    else
                    {
                        toAbandon.Add(msg);
                    }
                }

                // Complete and abandon in parallel for speed
                var tasks = new List<Task>();
                tasks.AddRange(toComplete.Select(m => dlqReceiver.CompleteMessageAsync(m)));
                tasks.AddRange(toAbandon.Select(m => dlqReceiver.AbandonMessageAsync(m)));
                await Task.WhenAll(tasks);

                completed += toComplete.Count;
            }
            return completed;
        }
    }

    public async Task<QueuePropertiesDto?> GetQueuePropertiesAsync(int connectionId, string queueName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = GetManagementClient(connection);
        var props = (await adminClient.GetQueueAsync(queueName)).Value;
        var dto = new QueuePropertiesDto
        {
            Name = props.Name,
            Status = props.Status.ToString(),
            DefaultMessageTimeToLive = props.DefaultMessageTimeToLive,
            LockDuration = props.LockDuration,
            AutoDeleteOnIdle = props.AutoDeleteOnIdle,
            DuplicateDetectionHistoryTimeWindow = props.DuplicateDetectionHistoryTimeWindow,
            MaxDeliveryCount = props.MaxDeliveryCount,
            RequiresDuplicateDetection = props.RequiresDuplicateDetection,
            RequiresSession = props.RequiresSession,
            DeadLetteringOnMessageExpiration = props.DeadLetteringOnMessageExpiration,
            EnableBatchedOperations = props.EnableBatchedOperations,
            EnablePartitioning = props.EnablePartitioning,
            ForwardTo = props.ForwardTo,
            ForwardDeadLetteredMessagesTo = props.ForwardDeadLetteredMessagesTo,
            MaxSizeInMegabytes = props.MaxSizeInMegabytes,
            MaxMessageSizeInKilobytes = props.MaxMessageSizeInKilobytes,
            UserMetadata = props.UserMetadata
        };

        // Runtime metrics live on a separate admin call; best-effort so a failure here
        // still returns the configuration above.
        try
        {
            var rt = (await adminClient.GetQueueRuntimePropertiesAsync(queueName)).Value;
            dto.TotalMessageCount = rt.TotalMessageCount;
            dto.ActiveMessageCount = rt.ActiveMessageCount;
            dto.DeadLetterMessageCount = rt.DeadLetterMessageCount;
            dto.ScheduledMessageCount = rt.ScheduledMessageCount;
            dto.TransferMessageCount = rt.TransferMessageCount;
            dto.TransferDeadLetterMessageCount = rt.TransferDeadLetterMessageCount;
            dto.SizeInBytes = rt.SizeInBytes;

            // The emulator's runtime properties are always zero, so browse for the real counts.
            if (connection.IsEmulator)
            {
                var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
                var counts = await CountByPeekBreakdownAsync(client, queueName, null, CancellationToken.None);
                (dto.ActiveMessageCount, dto.ScheduledMessageCount, dto.DeadLetterMessageCount, dto.TotalMessageCount) = counts;
            }

            dto.CreatedAt = rt.CreatedAt;
            dto.UpdatedAt = rt.UpdatedAt;
            dto.AccessedAt = rt.AccessedAt;
        }
        catch (ServiceBusException)
        {
        }

        return dto;
    }

    public async Task<TopicPropertiesDto?> GetTopicPropertiesAsync(int connectionId, string topicName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = GetManagementClient(connection);
        var props = (await adminClient.GetTopicAsync(topicName)).Value;
        var dto = new TopicPropertiesDto
        {
            Name = props.Name,
            Status = props.Status.ToString(),
            DefaultMessageTimeToLive = props.DefaultMessageTimeToLive,
            AutoDeleteOnIdle = props.AutoDeleteOnIdle,
            DuplicateDetectionHistoryTimeWindow = props.DuplicateDetectionHistoryTimeWindow,
            RequiresDuplicateDetection = props.RequiresDuplicateDetection,
            EnableBatchedOperations = props.EnableBatchedOperations,
            EnablePartitioning = props.EnablePartitioning,
            SupportOrdering = props.SupportOrdering,
            MaxSizeInMegabytes = props.MaxSizeInMegabytes,
            MaxMessageSizeInKilobytes = props.MaxMessageSizeInKilobytes,
            UserMetadata = props.UserMetadata
        };

        try
        {
            var rt = (await adminClient.GetTopicRuntimePropertiesAsync(topicName)).Value;
            dto.SubscriptionCount = rt.SubscriptionCount;
            dto.ScheduledMessageCount = rt.ScheduledMessageCount;
            dto.SizeInBytes = rt.SizeInBytes;
            dto.CreatedAt = rt.CreatedAt;
            dto.UpdatedAt = rt.UpdatedAt;
            dto.AccessedAt = rt.AccessedAt;
        }
        catch (ServiceBusException)
        {
        }

        return dto;
    }

    public async Task<SubscriptionPropertiesDto?> GetSubscriptionPropertiesAsync(int connectionId, string topicName, string subscriptionName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = GetManagementClient(connection);
        var props = (await adminClient.GetSubscriptionAsync(topicName, subscriptionName)).Value;
        var dto = new SubscriptionPropertiesDto
        {
            Name = props.SubscriptionName,
            TopicName = props.TopicName,
            Status = props.Status.ToString(),
            DefaultMessageTimeToLive = props.DefaultMessageTimeToLive,
            LockDuration = props.LockDuration,
            AutoDeleteOnIdle = props.AutoDeleteOnIdle,
            MaxDeliveryCount = props.MaxDeliveryCount,
            RequiresSession = props.RequiresSession,
            DeadLetteringOnMessageExpiration = props.DeadLetteringOnMessageExpiration,
            DeadLetteringOnFilterEvaluationExceptions = props.EnableDeadLetteringOnFilterEvaluationExceptions,
            EnableBatchedOperations = props.EnableBatchedOperations,
            ForwardTo = props.ForwardTo,
            ForwardDeadLetteredMessagesTo = props.ForwardDeadLetteredMessagesTo,
            UserMetadata = props.UserMetadata
        };

        try
        {
            var rt = (await adminClient.GetSubscriptionRuntimePropertiesAsync(topicName, subscriptionName)).Value;
            dto.TotalMessageCount = rt.TotalMessageCount;
            dto.ActiveMessageCount = rt.ActiveMessageCount;
            dto.DeadLetterMessageCount = rt.DeadLetterMessageCount;
            dto.TransferMessageCount = rt.TransferMessageCount;
            dto.TransferDeadLetterMessageCount = rt.TransferDeadLetterMessageCount;

            // Same emulator limitation as GetQueuePropertiesAsync.
            if (connection.IsEmulator)
            {
                var client = _clientCache.GetClient(connectionId, connection.ConnectionString);
                var (active, _, deadLetter, total) = await CountByPeekBreakdownAsync(client, topicName, subscriptionName, CancellationToken.None);
                (dto.ActiveMessageCount, dto.DeadLetterMessageCount, dto.TotalMessageCount) = (active, deadLetter, total);
            }

            dto.CreatedAt = rt.CreatedAt;
            dto.UpdatedAt = rt.UpdatedAt;
            dto.AccessedAt = rt.AccessedAt;
        }
        catch (ServiceBusException)
        {
        }

        return dto;
    }

    public async Task<List<SubscriptionRuleDto>?> GetSubscriptionRulesAsync(int connectionId, string topicName, string subscriptionName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = GetManagementClient(connection);

        var rules = new List<SubscriptionRuleDto>();
        await foreach (var rule in adminClient.GetRulesAsync(topicName, subscriptionName))
        {
            rules.Add(MapRuleToDto(rule));
        }
        return rules;
    }

    private static SubscriptionRuleDto MapRuleToDto(RuleProperties rule)
    {
        var dto = new SubscriptionRuleDto { Name = rule.Name };

        // TrueRuleFilter and FalseRuleFilter both derive from SqlRuleFilter, so they must be
        // matched before the general SqlRuleFilter case.
        switch (rule.Filter)
        {
            case TrueRuleFilter:
                dto.FilterType = "True";
                break;
            case FalseRuleFilter:
                dto.FilterType = "False";
                break;
            case SqlRuleFilter sql:
                dto.FilterType = "Sql";
                dto.SqlFilter = sql.SqlExpression;
                break;
            case CorrelationRuleFilter cf:
                dto.FilterType = "Correlation";
                dto.CorrelationFilter = new CorrelationFilterDto
                {
                    CorrelationId = cf.CorrelationId,
                    MessageId = cf.MessageId,
                    To = cf.To,
                    ReplyTo = cf.ReplyTo,
                    Subject = cf.Subject,
                    SessionId = cf.SessionId,
                    ReplyToSessionId = cf.ReplyToSessionId,
                    ContentType = cf.ContentType,
                    ApplicationProperties = cf.ApplicationProperties.Count > 0
                        ? new Dictionary<string, object>(cf.ApplicationProperties)
                        : null
                };
                break;
            default:
                dto.FilterType = "Unknown";
                break;
        }

        if (rule.Action is SqlRuleAction action)
        {
            dto.Action = action.SqlExpression;
        }

        return dto;
    }

    public async Task<bool> CreateQueueAsync(int connectionId, CreateQueueDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        var options = new CreateQueueOptions(dto.Name);
        if (dto.DefaultMessageTimeToLive.HasValue)
        {
            options.DefaultMessageTimeToLive = dto.DefaultMessageTimeToLive.Value;
        }
        if (dto.LockDuration.HasValue)
        {
            options.LockDuration = dto.LockDuration.Value;
        }
        if (dto.MaxDeliveryCount.HasValue)
        {
            options.MaxDeliveryCount = dto.MaxDeliveryCount.Value;
        }
        if (dto.RequiresDuplicateDetection.HasValue)
        {
            options.RequiresDuplicateDetection = dto.RequiresDuplicateDetection.Value;
        }
        if (dto.RequiresSession.HasValue)
        {
            options.RequiresSession = dto.RequiresSession.Value;
        }
        if (dto.DeadLetteringOnMessageExpiration.HasValue)
        {
            options.DeadLetteringOnMessageExpiration = dto.DeadLetteringOnMessageExpiration.Value;
        }
        if (!string.IsNullOrEmpty(dto.ForwardTo))
        {
            options.ForwardTo = dto.ForwardTo;
        }
        if (!string.IsNullOrEmpty(dto.ForwardDeadLetteredMessagesTo))
        {
            options.ForwardDeadLetteredMessagesTo = dto.ForwardDeadLetteredMessagesTo;
        }
        await adminClient.CreateQueueAsync(options);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> CreateTopicAsync(int connectionId, CreateTopicDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        var options = new CreateTopicOptions(dto.Name);
        if (dto.DefaultMessageTimeToLive.HasValue)
        {
            options.DefaultMessageTimeToLive = dto.DefaultMessageTimeToLive.Value;
        }
        if (dto.RequiresDuplicateDetection.HasValue)
        {
            options.RequiresDuplicateDetection = dto.RequiresDuplicateDetection.Value;
        }
        await adminClient.CreateTopicAsync(options);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> CreateSubscriptionAsync(int connectionId, string topicName, CreateSubscriptionDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        var options = new CreateSubscriptionOptions(topicName, dto.Name);
        if (dto.DefaultMessageTimeToLive.HasValue)
        {
            options.DefaultMessageTimeToLive = dto.DefaultMessageTimeToLive.Value;
        }
        if (dto.LockDuration.HasValue)
        {
            options.LockDuration = dto.LockDuration.Value;
        }
        if (dto.MaxDeliveryCount.HasValue)
        {
            options.MaxDeliveryCount = dto.MaxDeliveryCount.Value;
        }
        if (dto.RequiresSession.HasValue)
        {
            options.RequiresSession = dto.RequiresSession.Value;
        }
        if (dto.DeadLetteringOnMessageExpiration.HasValue)
        {
            options.DeadLetteringOnMessageExpiration = dto.DeadLetteringOnMessageExpiration.Value;
        }
        if (!string.IsNullOrEmpty(dto.ForwardTo))
        {
            options.ForwardTo = dto.ForwardTo;
        }
        if (!string.IsNullOrEmpty(dto.ForwardDeadLetteredMessagesTo))
        {
            options.ForwardDeadLetteredMessagesTo = dto.ForwardDeadLetteredMessagesTo;
        }
        await adminClient.CreateSubscriptionAsync(options);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> UpdateQueueAsync(int connectionId, string queueName, UpdateQueueDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        var props = await adminClient.GetQueueAsync(queueName);
        if (!string.IsNullOrEmpty(dto.Status))
        {
            props.Value.Status = dto.Status; // EntityStatus has implicit conversion from string
        }
        if (dto.DefaultMessageTimeToLive.HasValue)
        {
            props.Value.DefaultMessageTimeToLive = dto.DefaultMessageTimeToLive.Value;
        }
        if (dto.LockDuration.HasValue)
        {
            props.Value.LockDuration = dto.LockDuration.Value;
        }
        if (dto.MaxDeliveryCount.HasValue)
        {
            props.Value.MaxDeliveryCount = dto.MaxDeliveryCount.Value;
        }
        if (dto.DeadLetteringOnMessageExpiration.HasValue)
        {
            props.Value.DeadLetteringOnMessageExpiration = dto.DeadLetteringOnMessageExpiration.Value;
        }
        props.Value.ForwardTo = dto.ForwardTo;
        props.Value.ForwardDeadLetteredMessagesTo = dto.ForwardDeadLetteredMessagesTo;
        await adminClient.UpdateQueueAsync(props.Value);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> UpdateTopicAsync(int connectionId, string topicName, UpdateTopicDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        var props = await adminClient.GetTopicAsync(topicName);
        if (!string.IsNullOrEmpty(dto.Status))
        {
            props.Value.Status = dto.Status; // EntityStatus has implicit conversion from string
        }
        if (dto.DefaultMessageTimeToLive.HasValue)
        {
            props.Value.DefaultMessageTimeToLive = dto.DefaultMessageTimeToLive.Value;
        }
        await adminClient.UpdateTopicAsync(props.Value);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> UpdateSubscriptionAsync(int connectionId, string topicName, string subscriptionName, UpdateSubscriptionDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        var props = await adminClient.GetSubscriptionAsync(topicName, subscriptionName);
        if (!string.IsNullOrEmpty(dto.Status))
        {
            props.Value.Status = dto.Status; // EntityStatus has implicit conversion from string
        }
        if (dto.DefaultMessageTimeToLive.HasValue)
        {
            props.Value.DefaultMessageTimeToLive = dto.DefaultMessageTimeToLive.Value;
        }
        if (dto.LockDuration.HasValue)
        {
            props.Value.LockDuration = dto.LockDuration.Value;
        }
        if (dto.MaxDeliveryCount.HasValue)
        {
            props.Value.MaxDeliveryCount = dto.MaxDeliveryCount.Value;
        }
        if (dto.DeadLetteringOnMessageExpiration.HasValue)
        {
            props.Value.DeadLetteringOnMessageExpiration = dto.DeadLetteringOnMessageExpiration.Value;
        }
        props.Value.ForwardTo = dto.ForwardTo;
        props.Value.ForwardDeadLetteredMessagesTo = dto.ForwardDeadLetteredMessagesTo;
        await adminClient.UpdateSubscriptionAsync(props.Value);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> DeleteQueueAsync(int connectionId, string queueName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        await adminClient.DeleteQueueAsync(queueName);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> DeleteTopicAsync(int connectionId, string topicName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        await adminClient.DeleteTopicAsync(topicName);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> DeleteSubscriptionAsync(int connectionId, string topicName, string subscriptionName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = GetManagementClient(connection);
        await adminClient.DeleteSubscriptionAsync(topicName, subscriptionName);
        _entityCache.Invalidate(connectionId);
        return true;
    }
}
