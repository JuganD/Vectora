using Microsoft.AspNetCore.Mvc;
using Vectora.Api.Helpers;
using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class ServiceBusMessageEndpoints
{
    public static void MapServiceBusMessageEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/connections/{connectionId:int}/servicebus").WithTags("ServiceBusMessages");

        // Peek operations
        group.MapGet("/queues/{queueName}/messages", PeekQueueMessages)
            .WithName("PeekQueueMessages");

        group.MapGet("/topics/{topicName}/subscriptions/{subscriptionName}/messages", PeekSubscriptionMessages)
            .WithName("PeekSubscriptionMessages");

        // Receive operations
        group.MapPost("/queues/{queueName}/messages/receive", ReceiveQueueMessages)
            .WithName("ReceiveQueueMessages");

        group.MapPost("/topics/{topicName}/subscriptions/{subscriptionName}/messages/receive", ReceiveSubscriptionMessages)
            .WithName("ReceiveSubscriptionMessages");

        // Send operations
        group.MapPost("/queues/{queueName}/messages", SendToQueue)
            .WithName("SendToQueue");

        group.MapPost("/topics/{topicName}/messages", SendToTopic)
            .WithName("SendToTopic");

        // Dead letter return operations
        group.MapPost("/queues/{queueName}/deadletter/{sequenceNumber}/return", ReturnQueueDeadLetter)
            .WithName("ReturnQueueDeadLetter");

        group.MapPost("/topics/{topicName}/subscriptions/{subscriptionName}/deadletter/{sequenceNumber}/return", ReturnSubscriptionDeadLetter)
            .WithName("ReturnSubscriptionDeadLetter");

        group.MapPost("/queues/{queueName}/deadletter/return/batch", ReturnQueueDeadLetterBatch)
            .WithName("ReturnQueueDeadLetterBatch");

        group.MapPost("/topics/{topicName}/subscriptions/{subscriptionName}/deadletter/return/batch", ReturnSubscriptionDeadLetterBatch)
            .WithName("ReturnSubscriptionDeadLetterBatch");

        // Dead letter consume operations (delete selected messages from DLQ)
        group.MapPost("/queues/{queueName}/deadletter/receive/batch", ReceiveQueueDeadLetterBatch)
            .WithName("ReceiveQueueDeadLetterBatch");

        group.MapPost("/topics/{topicName}/subscriptions/{subscriptionName}/deadletter/receive/batch", ReceiveSubscriptionDeadLetterBatch)
            .WithName("ReceiveSubscriptionDeadLetterBatch");
    }

    private static async Task<IResult> PeekQueueMessages(int connectionId, string queueName, IServiceBusService serviceBusService, [FromQuery] int maxMessages = 50, [FromQuery] bool deadLetter = false, [FromQuery] long? fromSequenceNumber = null)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateMaxMessages(maxMessages);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var messages = await serviceBusService.PeekMessagesAsync(connectionId, queueName, null, maxMessages, deadLetter, fromSequenceNumber);
        if (messages == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(messages);
    }

    private static async Task<IResult> PeekSubscriptionMessages(int connectionId, string topicName, string subscriptionName, IServiceBusService serviceBusService, [FromQuery] int maxMessages = 50, [FromQuery] bool deadLetter = false, [FromQuery] long? fromSequenceNumber = null)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateMaxMessages(maxMessages);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var messages = await serviceBusService.PeekMessagesAsync(connectionId, topicName, subscriptionName, maxMessages, deadLetter, fromSequenceNumber);
        if (messages == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(messages);
    }

    private static async Task<IResult> ReceiveQueueMessages(int connectionId, string queueName, IServiceBusService serviceBusService, [FromQuery] int maxMessages = 10, [FromQuery] bool deadLetter = false)
    {
        // Validate input - allow up to 100,000 for consume/purge operations
        var (valid, error) = ValidationHelper.ValidateMaxMessages(maxMessages, 100000);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var messages = await serviceBusService.ReceiveMessagesAsync(connectionId, queueName, null, maxMessages, deadLetter);
        if (messages == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(messages);
    }

    private static async Task<IResult> ReceiveSubscriptionMessages(int connectionId, string topicName, string subscriptionName, IServiceBusService serviceBusService, [FromQuery] int maxMessages = 10, [FromQuery] bool deadLetter = false)
    {
        // Validate input - allow up to 100,000 for consume/purge operations
        var (valid, error) = ValidationHelper.ValidateMaxMessages(maxMessages, 100000);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var messages = await serviceBusService.ReceiveMessagesAsync(connectionId, topicName, subscriptionName, maxMessages, deadLetter);
        if (messages == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(messages);
    }

    private static async Task<IResult> SendToQueue(int connectionId, string queueName, SendMessageDto dto, IServiceBusService serviceBusService)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateMessageBody(dto.Body);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var success = await serviceBusService.SendMessageAsync(connectionId, queueName, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> SendToTopic(int connectionId, string topicName, SendMessageDto dto, IServiceBusService serviceBusService)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateMessageBody(dto.Body);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var success = await serviceBusService.SendMessageAsync(connectionId, topicName, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> ReturnQueueDeadLetter(int connectionId, string queueName, long sequenceNumber, [FromBody] SendMessageDto? modifiedMessage, IServiceBusService serviceBusService, [FromQuery] bool deleteOriginal = true)
    {
        var result = await serviceBusService.ReturnDeadLetterMessageAsync(connectionId, queueName, null, sequenceNumber, modifiedMessage, deleteOriginal);
        return result switch
        {
            null => Results.NotFound("Connection not found"),
            false => Results.NotFound("Message not found"),
            true => Results.Ok()
        };
    }

    private static async Task<IResult> ReturnSubscriptionDeadLetter(int connectionId, string topicName, string subscriptionName, long sequenceNumber, [FromBody] SendMessageDto? modifiedMessage, IServiceBusService serviceBusService, [FromQuery] bool deleteOriginal = true)
    {
        var result = await serviceBusService.ReturnDeadLetterMessageAsync(connectionId, topicName, subscriptionName, sequenceNumber, modifiedMessage, deleteOriginal);
        return result switch
        {
            null => Results.NotFound("Connection not found"),
            false => Results.NotFound("Message not found"),
            true => Results.Ok()
        };
    }

    private static async Task<IResult> ReturnQueueDeadLetterBatch(int connectionId, string queueName, [FromBody] long[] sequenceNumbers, IServiceBusService serviceBusService)
    {
        var count = await serviceBusService.ReturnDeadLetterMessagesAsync(connectionId, queueName, null, sequenceNumbers);
        if (count == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(new { processed = count });
    }

    private static async Task<IResult> ReturnSubscriptionDeadLetterBatch(int connectionId, string topicName, string subscriptionName, [FromBody] long[] sequenceNumbers, IServiceBusService serviceBusService)
    {
        var count = await serviceBusService.ReturnDeadLetterMessagesAsync(connectionId, topicName, subscriptionName, sequenceNumbers);
        if (count == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(new { processed = count });
    }

    private static async Task<IResult> ReceiveQueueDeadLetterBatch(int connectionId, string queueName, [FromBody] long[] sequenceNumbers, IServiceBusService serviceBusService)
    {
        var count = await serviceBusService.ReceiveDeadLetterMessagesBySequenceAsync(connectionId, queueName, null, sequenceNumbers);
        if (count == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(new { processed = count });
    }

    private static async Task<IResult> ReceiveSubscriptionDeadLetterBatch(int connectionId, string topicName, string subscriptionName, [FromBody] long[] sequenceNumbers, IServiceBusService serviceBusService)
    {
        var count = await serviceBusService.ReceiveDeadLetterMessagesBySequenceAsync(connectionId, topicName, subscriptionName, sequenceNumbers);
        if (count == null)
        {
            return Results.NotFound("Connection not found");
        }
        return Results.Ok(new { processed = count });
    }
}
