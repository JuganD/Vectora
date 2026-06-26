using Azure.Messaging.ServiceBus;
using Azure.Messaging.ServiceBus.Administration;
using Vectora.Api.Helpers;
using Vectora.Api.Models;
using Vectora.Api.Repositories;

namespace Vectora.Api.Services;

public class ServiceBusService : IServiceBusService
{
    private readonly IConnectionRepository _connectionRepository;
    private readonly IEmulatorConfigService _emulatorConfigService;
    private readonly IServiceBusClientCache _clientCache;
    private readonly IServiceBusEntityCache _entityCache;
    private readonly ISettingsService _settingsService;
    private readonly int _emulatorAdminPort;

    public ServiceBusService(IConnectionRepository connectionRepository, IEmulatorConfigService emulatorConfigService, IServiceBusClientCache clientCache, IServiceBusEntityCache entityCache, ISettingsService settingsService, IConfiguration configuration)
    {
        _connectionRepository = connectionRepository;
        _emulatorConfigService = emulatorConfigService;
        _clientCache = clientCache;
        _entityCache = entityCache;
        _settingsService = settingsService;
        // The emulator serves the management API on its own HTTP port (5300 by default).
        // Configurable to match a custom EMULATOR_HTTP_PORT on the emulator side.
        _emulatorAdminPort = configuration.GetValue<int?>("EmulatorAdminPort") ?? EmulatorAdmin.DefaultAdminPort;
    }

    // Probe timeout for the emulator management port. Short because it targets a local/container
    // endpoint and runs on the entity-load path.
    private static readonly TimeSpan EmulatorAdminProbeTimeout = TimeSpan.FromSeconds(2);

    /// <summary>
    /// Decides whether an emulator connection's management API is reachable. The result is cached
    /// on the (singleton) client cache; pass <paramref name="forceProbe"/> to re-probe (e.g. on an
    /// explicit refresh) so an emulator that started after the first check is picked up.
    /// </summary>
    private async Task<bool> IsEmulatorAdminAvailableAsync(ServiceBusConnection connection, bool forceProbe, CancellationToken cancellationToken)
    {
        if (!connection.IsEmulator) return false;

        if (!forceProbe)
        {
            var cached = _clientCache.GetEmulatorAdminAvailability(connection.Id);
            if (cached.HasValue) return cached.Value;
        }

        var endpoint = EmulatorAdmin.GetAdminEndpoint(connection.ConnectionString, _emulatorAdminPort);
        var available = endpoint.HasValue
            && await EmulatorAdmin.IsPortReachableAsync(endpoint.Value.Host, endpoint.Value.Port, EmulatorAdminProbeTimeout, cancellationToken);
        _clientCache.SetEmulatorAdminAvailability(connection.Id, available);
        return available;
    }

    /// <summary>
    /// Returns the administration client to use for entity management, or null when the connection
    /// is an emulator whose management port is unreachable (the caller then falls back to the stored
    /// emulator config). Real Service Bus connections always return a client.
    /// </summary>
    private async Task<ServiceBusAdministrationClient?> GetManagementClientAsync(ServiceBusConnection connection, bool forceProbe = false, CancellationToken cancellationToken = default)
    {
        if (!connection.IsEmulator)
        {
            return _clientCache.GetAdminClient(connection.Id, connection.ConnectionString);
        }

        if (!await IsEmulatorAdminAvailableAsync(connection, forceProbe, cancellationToken))
        {
            return null;
        }

        var adminConnectionString = EmulatorAdmin.BuildAdminConnectionString(connection.ConnectionString, _emulatorAdminPort);
        return _clientCache.GetEmulatorAdminClient(connection.Id, connection.ConnectionString, adminConnectionString);
    }

    public async Task<(List<QueueInfoDto> Queues, List<TopicInfoDto> Topics, bool SupportsManagement)?> GetEntitiesAsync(int connectionId, bool refreshCache = false, CancellationToken cancellationToken = default)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        if (!refreshCache && _entityCache.TryGet(connectionId, out var cached))
        {
            // Management capability isn't part of the cached entity payload; derive it from the
            // (cheap, cached) admin-availability flag so the cache hit stays consistent.
            var cachedSupportsManagement = !connection.IsEmulator
                || (_clientCache.GetEmulatorAdminAvailability(connectionId) ?? false);
            return (cached.Queues, cached.Topics, cachedSupportsManagement);
        }

        var queues = new List<QueueInfoDto>();
        var topics = new List<TopicInfoDto>();

        // Re-probe the emulator management port on an explicit refresh so an emulator started
        // after the initial check is detected. Real connections always get an admin client.
        var adminClient = await GetManagementClientAsync(connection, forceProbe: refreshCache, cancellationToken);
        var supportsManagement = adminClient != null;

        if (adminClient == null)
        {
            // Emulator with no reachable management API: fall back to the stored config and
            // report zero counts (the emulator's data plane can't surface them here).
            if (connection.EmulatorConfigId.HasValue)
            {
                var queueConfigs = await _emulatorConfigService.GetQueuesFromConfigAsync(connection.EmulatorConfigId.Value);
                queues.AddRange(queueConfigs.Select(q => new QueueInfoDto { Name = q.Name, ActiveMessageCount = 0, DeadLetterMessageCount = 0, IsEmulator = true, RequiresSession = q.RequiresSession }));

                var topicData = await _emulatorConfigService.GetTopicsFromConfigAsync(connection.EmulatorConfigId.Value);
                topics.AddRange(topicData.Select(t => new TopicInfoDto
                {
                    Name = t.TopicName,
                    Subscriptions = t.Subscriptions.Select(s => new SubscriptionInfoDto { Name = s.Name, ActiveMessageCount = 0, DeadLetterMessageCount = 0, RequiresSession = s.RequiresSession }).ToList(),
                    IsEmulator = true
                }));
            }
        }
        else
        {
            // Real Service Bus or an emulator with a reachable management API: use the
            // Administration client. RequiresSession lives on the entity properties (not the
            // runtime properties that carry message counts), so we pull both and merge by name.
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

        var orderedQueues = queues.OrderBy(q => q.Name).ToList();
        var orderedTopics = topics.OrderBy(t => t.Name).ToList();
        _entityCache.Set(connectionId, orderedQueues, orderedTopics);
        return (orderedQueues, orderedTopics, supportsManagement);
    }

    public async Task<QueueInfoDto?> GetQueueRuntimeInfoAsync(int connectionId, string queueName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return null;
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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return null;
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

    public async Task<List<ServiceBusMessageDto>?> ReceiveMessagesAsync(int connectionId, string entityPath, string? subscriptionName, int maxMessages, bool deadLetter)
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
            var allMessages = new List<ServiceBusMessageDto>();
            var remaining = maxMessages;
            var timeoutSeconds = await _settingsService.GetBatchOperationTimeoutSecondsAsync();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(timeoutSeconds);

            while (remaining > 0 && DateTime.UtcNow < deadline)
            {
                var batchSize = Math.Min(remaining, 256);
                var messages = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(5));

                if (messages.Count == 0)
                    break;

                allMessages.AddRange(messages.Select(MapToDto));

                foreach (var msg in messages)
                {
                    await receiver.CompleteMessageAsync(msg);
                }

                remaining -= messages.Count;
            }

            return allMessages;
        }
    }

    public async Task<int?> ReceiveMessagesBySequenceAsync(int connectionId, string entityPath, string? subscriptionName, IEnumerable<long> sequenceNumbers, bool deadLetter)
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

            while (sequenceSet.Count > 0 && DateTime.UtcNow < deadline)
            {
                var received = await receiver.ReceiveMessagesAsync(batchSize, TimeSpan.FromSeconds(1));
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
                tasks.AddRange(toComplete.Select(m => receiver.CompleteMessageAsync(m)));
                tasks.AddRange(toAbandon.Select(m => receiver.AbandonMessageAsync(m)));
                await Task.WhenAll(tasks);

                completed += toComplete.Count;
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
            foreach (var kvp in dto.ApplicationProperties)
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
            ApplicationProperties = msg.ApplicationProperties.ToDictionary(k => k.Key, v => v.Value)
        };
    }

    private static ServiceBusReceiver CreateBrowseReceiver(ServiceBusClient client, string entityPath, string? subscriptionName, bool deadLetter)
    {
        var options = new ServiceBusReceiverOptions { SubQueue = deadLetter ? SubQueue.DeadLetter : SubQueue.None };
        return subscriptionName != null
            ? client.CreateReceiver(entityPath, subscriptionName, options)
            : client.CreateReceiver(entityPath, options);
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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return null;
        var props = await adminClient.GetQueueAsync(queueName);
        return new QueuePropertiesDto
        {
            Name = props.Value.Name,
            Status = props.Value.Status.ToString(),
            DefaultMessageTimeToLive = props.Value.DefaultMessageTimeToLive,
            LockDuration = props.Value.LockDuration,
            MaxDeliveryCount = props.Value.MaxDeliveryCount,
            RequiresDuplicateDetection = props.Value.RequiresDuplicateDetection,
            RequiresSession = props.Value.RequiresSession,
            DeadLetteringOnMessageExpiration = props.Value.DeadLetteringOnMessageExpiration,
            ForwardTo = props.Value.ForwardTo,
            ForwardDeadLetteredMessagesTo = props.Value.ForwardDeadLetteredMessagesTo,
            MaxSizeInMegabytes = props.Value.MaxSizeInMegabytes
        };
    }

    public async Task<TopicPropertiesDto?> GetTopicPropertiesAsync(int connectionId, string topicName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return null;
        var props = await adminClient.GetTopicAsync(topicName);
        return new TopicPropertiesDto
        {
            Name = props.Value.Name,
            Status = props.Value.Status.ToString(),
            DefaultMessageTimeToLive = props.Value.DefaultMessageTimeToLive,
            RequiresDuplicateDetection = props.Value.RequiresDuplicateDetection,
            MaxSizeInMegabytes = props.Value.MaxSizeInMegabytes
        };
    }

    public async Task<SubscriptionPropertiesDto?> GetSubscriptionPropertiesAsync(int connectionId, string topicName, string subscriptionName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return null;

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return null;
        var props = await adminClient.GetSubscriptionAsync(topicName, subscriptionName);
        return new SubscriptionPropertiesDto
        {
            Name = props.Value.SubscriptionName,
            TopicName = props.Value.TopicName,
            Status = props.Value.Status.ToString(),
            DefaultMessageTimeToLive = props.Value.DefaultMessageTimeToLive,
            LockDuration = props.Value.LockDuration,
            MaxDeliveryCount = props.Value.MaxDeliveryCount,
            RequiresSession = props.Value.RequiresSession,
            DeadLetteringOnMessageExpiration = props.Value.DeadLetteringOnMessageExpiration,
            ForwardTo = props.Value.ForwardTo,
            ForwardDeadLetteredMessagesTo = props.Value.ForwardDeadLetteredMessagesTo
        };
    }

    public async Task<bool> CreateQueueAsync(int connectionId, CreateQueueDto dto)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null)
        {
            if (connection.EmulatorConfigId.HasValue)
            {
                await _emulatorConfigService.AddQueueToConfigAsync(connection.EmulatorConfigId.Value, dto.Name);
                _entityCache.Invalidate(connectionId);
                return true;
            }
            return false;
        }

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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null)
        {
            if (connection.EmulatorConfigId.HasValue)
            {
                await _emulatorConfigService.AddTopicToConfigAsync(connection.EmulatorConfigId.Value, dto.Name);
                _entityCache.Invalidate(connectionId);
                return true;
            }
            return false;
        }

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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null)
        {
            if (connection.EmulatorConfigId.HasValue)
            {
                await _emulatorConfigService.AddSubscriptionToConfigAsync(connection.EmulatorConfigId.Value, topicName, dto.Name);
                _entityCache.Invalidate(connectionId);
                return true;
            }
            return false;
        }

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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return false;
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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return false;
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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null) return false;
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

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null)
        {
            if (connection.EmulatorConfigId.HasValue)
            {
                await _emulatorConfigService.DeleteQueueFromConfigAsync(connection.EmulatorConfigId.Value, queueName);
                _entityCache.Invalidate(connectionId);
                return true;
            }
            return false;
        }

        await adminClient.DeleteQueueAsync(queueName);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> DeleteTopicAsync(int connectionId, string topicName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null)
        {
            if (connection.EmulatorConfigId.HasValue)
            {
                await _emulatorConfigService.DeleteTopicFromConfigAsync(connection.EmulatorConfigId.Value, topicName);
                _entityCache.Invalidate(connectionId);
                return true;
            }
            return false;
        }

        await adminClient.DeleteTopicAsync(topicName);
        _entityCache.Invalidate(connectionId);
        return true;
    }

    public async Task<bool> DeleteSubscriptionAsync(int connectionId, string topicName, string subscriptionName)
    {
        var connection = await _connectionRepository.GetByIdAsync(connectionId);
        if (connection == null) return false;

        var adminClient = await GetManagementClientAsync(connection);
        if (adminClient == null)
        {
            if (connection.EmulatorConfigId.HasValue)
            {
                await _emulatorConfigService.DeleteSubscriptionFromConfigAsync(connection.EmulatorConfigId.Value, topicName, subscriptionName);
                _entityCache.Invalidate(connectionId);
                return true;
            }
            return false;
        }

        await adminClient.DeleteSubscriptionAsync(topicName, subscriptionName);
        _entityCache.Invalidate(connectionId);
        return true;
    }
}

