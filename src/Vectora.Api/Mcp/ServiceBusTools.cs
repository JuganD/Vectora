using System.ComponentModel;
using Azure.Messaging.ServiceBus;
using ModelContextProtocol;
using ModelContextProtocol.Server;
using Vectora.Api.Models;
using Vectora.Api.Repositories;
using Vectora.Api.Services;

namespace Vectora.Api.Mcp;

// MCP tools exposed to AI agents over the /mcp endpoint.
//
// Safety model:
//  - Only connections explicitly flagged McpExposed are visible or readable; a guessed id is rejected.
//  - All reads use lock-free peek (never receive/consume), so browsing never affects a live queue.
//  - Sending additionally requires the connection's McpAllowSend flag.
[McpServerToolType]
public static class ServiceBusTools
{
    private const int DefaultMaxMessages = 50;
    private const int MaxMessagesCap = 1000;

    [McpServerTool(Name = "list_connections")]
    [Description("Lists the Azure Service Bus connections that have been exposed to MCP. Returns each connection's id (use it for the other tools), name, whether it is an emulator, and whether sending messages is allowed. Connection strings/secrets are never returned.")]
    public static async Task<object> ListConnectionsAsync(IConnectionRepository connections)
    {
        var all = await connections.GetAllAsync();
        return all
            .Where(c => c.McpExposed)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                isEmulator = c.IsEmulator,
                canSend = c.McpAllowSend
            })
            .ToList();
    }

    [McpServerTool(Name = "list_entities")]
    [Description("Lists all entities for a connection: queues (with active/dead-letter message counts) and topics with their subscriptions. Use the connection id from list_connections.")]
    public static async Task<object> ListEntitiesAsync(
        IConnectionRepository connections,
        IServiceBusService serviceBus,
        [Description("The connection id from list_connections.")] int connectionId,
        CancellationToken cancellationToken)
    {
        await EnsureExposedAsync(connections, connectionId);

        var result = await serviceBus.GetEntitiesAsync(connectionId, refreshCache: false, cancellationToken);
        if (result == null)
        {
            throw new McpException("Connection not found.");
        }

        var (queues, topics, supportsManagement) = result.Value;
        return new { queues, topics, supportsManagement };
    }

    // Turns Service Bus SDK failures into McpException so the agent sees a real message
    // (e.g. entity-not-found) instead of the SDK's generic "An error occurred".
    private static async Task<T> InvokeServiceBusAsync<T>(Func<Task<T>> action, string entityPath)
    {
        try
        {
            return await action();
        }
        catch (ServiceBusException ex) when (ex.Reason == ServiceBusFailureReason.MessagingEntityNotFound)
        {
            throw new McpException($"Entity '{entityPath}' was not found on this connection.");
        }
        catch (ServiceBusException ex)
        {
            throw new McpException($"Service Bus error for '{entityPath}': {ex.Message}");
        }
    }

    [McpServerTool(Name = "peek_messages")]
    [Description("Peeks (read-only, non-destructive) the active messages in a queue or a topic subscription, returning full message data including body, system properties and application properties. Provide either queueName, or both topicName and subscriptionName. Messages are not locked, removed, or modified. Returns up to 'max' messages (default 50, hard cap 1000); pass the highest returned sequenceNumber + 1 as 'fromSequenceNumber' to page further.")]
    public static Task<object> PeekMessagesAsync(
        IConnectionRepository connections,
        IServiceBusService serviceBus,
        [Description("The connection id from list_connections.")] int connectionId,
        [Description("Queue name. Provide this OR topicName+subscriptionName.")] string? queueName = null,
        [Description("Topic name. Requires subscriptionName.")] string? topicName = null,
        [Description("Subscription name under the topic.")] string? subscriptionName = null,
        [Description("Max messages to return (default 50, max 1000).")] int max = DefaultMaxMessages,
        [Description("Sequence number to start peeking from, for paging.")] long? fromSequenceNumber = null)
        => PeekInternalAsync(connections, serviceBus, connectionId, queueName, topicName, subscriptionName, max, fromSequenceNumber, deadLetter: false);

    [McpServerTool(Name = "peek_dead_letter_messages")]
    [Description("Peeks (read-only, non-destructive) the dead-letter queue (DLQ) of a queue or topic subscription, returning full message data including the dead-letter reason, error description and source. Provide either queueName, or both topicName and subscriptionName. Returns up to 'max' messages (default 50, hard cap 1000); page with 'fromSequenceNumber'.")]
    public static Task<object> PeekDeadLetterMessagesAsync(
        IConnectionRepository connections,
        IServiceBusService serviceBus,
        [Description("The connection id from list_connections.")] int connectionId,
        [Description("Queue name. Provide this OR topicName+subscriptionName.")] string? queueName = null,
        [Description("Topic name. Requires subscriptionName.")] string? topicName = null,
        [Description("Subscription name under the topic.")] string? subscriptionName = null,
        [Description("Max messages to return (default 50, max 1000).")] int max = DefaultMaxMessages,
        [Description("Sequence number to start peeking from, for paging.")] long? fromSequenceNumber = null)
        => PeekInternalAsync(connections, serviceBus, connectionId, queueName, topicName, subscriptionName, max, fromSequenceNumber, deadLetter: true);

    [McpServerTool(Name = "send_message")]
    [Description("Sends a message to a queue or topic. Requires the connection to be exposed to MCP AND have message sending enabled. Provide either queueName or topicName (not a subscription — you send to the topic, not its subscriptions).")]
    public static async Task<object> SendMessageAsync(
        IConnectionRepository connections,
        IServiceBusService serviceBus,
        [Description("The connection id from list_connections.")] int connectionId,
        [Description("The message body (text). For JSON, pass the serialized JSON string.")] string body,
        [Description("Queue name to send to. Provide this OR topicName.")] string? queueName = null,
        [Description("Topic name to send to. Provide this OR queueName.")] string? topicName = null,
        [Description("Optional content type, e.g. application/json.")] string? contentType = null,
        [Description("Optional message subject/label.")] string? subject = null,
        [Description("Optional message id.")] string? messageId = null,
        [Description("Optional correlation id.")] string? correlationId = null,
        [Description("Optional session id (required for session-enabled entities).")] string? sessionId = null,
        [Description("Optional reply-to address.")] string? replyTo = null,
        [Description("Optional UTC time to schedule the message for future enqueue.")] DateTimeOffset? scheduledEnqueueTime = null,
        [Description("Optional custom application properties (string key/value pairs).")] Dictionary<string, string>? applicationProperties = null)
    {
        var connection = await EnsureExposedAsync(connections, connectionId);
        if (!connection.McpAllowSend)
        {
            throw new McpException($"Message sending is not enabled for connection '{connection.Name}'. Enable it in Vectora's MCP settings.");
        }

        string entityPath;
        if (!string.IsNullOrWhiteSpace(queueName))
        {
            entityPath = queueName;
        }
        else if (!string.IsNullOrWhiteSpace(topicName))
        {
            entityPath = topicName;
        }
        else
        {
            throw new McpException("Provide either queueName or topicName.");
        }

        if (string.IsNullOrWhiteSpace(body))
        {
            throw new McpException("Message body is required.");
        }

        var dto = new SendMessageDto
        {
            Body = body,
            ContentType = contentType,
            Subject = subject,
            MessageId = messageId,
            CorrelationId = correlationId,
            SessionId = sessionId,
            ReplyTo = replyTo,
            ScheduledEnqueueTime = scheduledEnqueueTime,
            ApplicationProperties = applicationProperties
        };

        var sent = await InvokeServiceBusAsync(() => serviceBus.SendMessageAsync(connectionId, entityPath, dto), entityPath);
        if (!sent)
        {
            throw new McpException("Connection not found.");
        }

        return new { success = true, entity = entityPath };
    }

    private static async Task<object> PeekInternalAsync(
        IConnectionRepository connections,
        IServiceBusService serviceBus,
        int connectionId,
        string? queueName,
        string? topicName,
        string? subscriptionName,
        int max,
        long? fromSequenceNumber,
        bool deadLetter)
    {
        await EnsureExposedAsync(connections, connectionId);

        var (entityPath, subscription) = ResolveReadTarget(queueName, topicName, subscriptionName);
        var clampedMax = Math.Clamp(max, 1, MaxMessagesCap);

        var label = subscription == null ? entityPath : $"{entityPath}/{subscription}";
        var messages = await InvokeServiceBusAsync(
            () => serviceBus.PeekMessagesAsync(connectionId, entityPath, subscription, clampedMax, deadLetter, fromSequenceNumber),
            label);
        if (messages == null)
        {
            throw new McpException("Connection not found.");
        }

        return new
        {
            messages,
            count = messages.Count,
            nextSequenceNumber = messages.Count > 0 ? messages[^1].SequenceNumber + 1 : (long?)null
        };
    }

    private static (string EntityPath, string? SubscriptionName) ResolveReadTarget(string? queueName, string? topicName, string? subscriptionName)
    {
        if (!string.IsNullOrWhiteSpace(queueName))
        {
            return (queueName, null);
        }

        if (!string.IsNullOrWhiteSpace(topicName) && !string.IsNullOrWhiteSpace(subscriptionName))
        {
            return (topicName, subscriptionName);
        }

        throw new McpException("Provide either queueName, or both topicName and subscriptionName.");
    }

    // Rejects any connection not flagged McpExposed, so unexposed (e.g. production) connections
    // stay unreachable even if their id is guessed.
    private static async Task<ServiceBusConnection> EnsureExposedAsync(IConnectionRepository connections, int connectionId)
    {
        var connection = await connections.GetByIdAsync(connectionId);
        if (connection == null || !connection.McpExposed)
        {
            throw new McpException($"Connection {connectionId} is not available to MCP.");
        }
        return connection;
    }
}
