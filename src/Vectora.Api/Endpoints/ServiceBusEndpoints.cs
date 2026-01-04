using Vectora.Api.Helpers;
using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class ServiceBusEndpoints
{
    public static void MapServiceBusEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/connections/{connectionId:int}/servicebus").WithTags("ServiceBus");

        // Entity operations
        group.MapGet("/entities", GetEntities)
            .WithName("GetServiceBusEntities");

        // Queue operations
        group.MapGet("/queues/{queueName}/runtime", GetQueueRuntimeInfo)
            .WithName("GetQueueRuntimeInfo");

        group.MapGet("/queues/{queueName}/properties", GetQueueProperties)
            .WithName("GetQueueProperties");

        group.MapPost("/queues", CreateQueue)
            .WithName("CreateQueue");

        group.MapPut("/queues/{queueName}", UpdateQueue)
            .WithName("UpdateQueue");

        group.MapDelete("/queues/{queueName}", DeleteQueue)
            .WithName("DeleteQueue");

        // Topic operations
        group.MapGet("/topics/{topicName}/properties", GetTopicProperties)
            .WithName("GetTopicProperties");

        group.MapPost("/topics", CreateTopic)
            .WithName("CreateTopic");

        group.MapPut("/topics/{topicName}", UpdateTopic)
            .WithName("UpdateTopic");

        group.MapDelete("/topics/{topicName}", DeleteTopic)
            .WithName("DeleteTopic");

        // Subscription operations
        group.MapGet("/topics/{topicName}/subscriptions/{subscriptionName}/runtime", GetSubscriptionRuntimeInfo)
            .WithName("GetSubscriptionRuntimeInfo");

        group.MapGet("/topics/{topicName}/subscriptions/{subscriptionName}/properties", GetSubscriptionProperties)
            .WithName("GetSubscriptionProperties");

        group.MapPost("/topics/{topicName}/subscriptions", CreateSubscription)
            .WithName("CreateSubscription");

        group.MapPut("/topics/{topicName}/subscriptions/{subscriptionName}", UpdateSubscription)
            .WithName("UpdateSubscription");

        group.MapDelete("/topics/{topicName}/subscriptions/{subscriptionName}", DeleteSubscription)
            .WithName("DeleteSubscription");
    }

    private static async Task<IResult> GetEntities(int connectionId, IServiceBusService serviceBusService)
    {
        var result = await serviceBusService.GetEntitiesAsync(connectionId);
        if (result == null)
        {
            return Results.NotFound("Connection not found");
        }

        var (queues, topics) = result.Value;
        return Results.Ok(new { queues, topics });
    }

    private static async Task<IResult> GetQueueRuntimeInfo(int connectionId, string queueName, IServiceBusService serviceBusService)
    {
        var info = await serviceBusService.GetQueueRuntimeInfoAsync(connectionId, queueName);
        if (info == null)
        {
            return Results.NotFound("Queue or connection not found");
        }
        return Results.Ok(info);
    }

    private static async Task<IResult> GetQueueProperties(int connectionId, string queueName, IServiceBusService serviceBusService)
    {
        var props = await serviceBusService.GetQueuePropertiesAsync(connectionId, queueName);
        if (props == null)
        {
            return Results.NotFound("Queue not found or not available for emulator");
        }
        return Results.Ok(props);
    }

    private static async Task<IResult> CreateQueue(int connectionId, CreateQueueDto dto, IServiceBusService serviceBusService)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateEntityName(dto.Name, "Queue");
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var success = await serviceBusService.CreateQueueAsync(connectionId, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> UpdateQueue(int connectionId, string queueName, UpdateQueueDto dto, IServiceBusService serviceBusService)
    {
        var success = await serviceBusService.UpdateQueueAsync(connectionId, queueName, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found or not supported for emulator");
    }

    private static async Task<IResult> DeleteQueue(int connectionId, string queueName, IServiceBusService serviceBusService)
    {
        var success = await serviceBusService.DeleteQueueAsync(connectionId, queueName);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> GetTopicProperties(int connectionId, string topicName, IServiceBusService serviceBusService)
    {
        var props = await serviceBusService.GetTopicPropertiesAsync(connectionId, topicName);
        if (props == null)
        {
            return Results.NotFound("Topic not found or not available for emulator");
        }
        return Results.Ok(props);
    }

    private static async Task<IResult> CreateTopic(int connectionId, CreateTopicDto dto, IServiceBusService serviceBusService)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateEntityName(dto.Name, "Topic");
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var success = await serviceBusService.CreateTopicAsync(connectionId, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> UpdateTopic(int connectionId, string topicName, UpdateTopicDto dto, IServiceBusService serviceBusService)
    {
        var success = await serviceBusService.UpdateTopicAsync(connectionId, topicName, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found or not supported for emulator");
    }

    private static async Task<IResult> DeleteTopic(int connectionId, string topicName, IServiceBusService serviceBusService)
    {
        var success = await serviceBusService.DeleteTopicAsync(connectionId, topicName);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> GetSubscriptionRuntimeInfo(int connectionId, string topicName, string subscriptionName, IServiceBusService serviceBusService)
    {
        var info = await serviceBusService.GetSubscriptionRuntimeInfoAsync(connectionId, topicName, subscriptionName);
        if (info == null)
        {
            return Results.NotFound("Subscription or connection not found");
        }
        return Results.Ok(info);
    }

    private static async Task<IResult> GetSubscriptionProperties(int connectionId, string topicName, string subscriptionName, IServiceBusService serviceBusService)
    {
        var props = await serviceBusService.GetSubscriptionPropertiesAsync(connectionId, topicName, subscriptionName);
        if (props == null)
        {
            return Results.NotFound("Subscription not found or not available for emulator");
        }
        return Results.Ok(props);
    }

    private static async Task<IResult> CreateSubscription(int connectionId, string topicName, CreateSubscriptionDto dto, IServiceBusService serviceBusService)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateEntityName(dto.Name, "Subscription");
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        var success = await serviceBusService.CreateSubscriptionAsync(connectionId, topicName, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }

    private static async Task<IResult> UpdateSubscription(int connectionId, string topicName, string subscriptionName, UpdateSubscriptionDto dto, IServiceBusService serviceBusService)
    {
        var success = await serviceBusService.UpdateSubscriptionAsync(connectionId, topicName, subscriptionName, dto);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found or not supported for emulator");
    }

    private static async Task<IResult> DeleteSubscription(int connectionId, string topicName, string subscriptionName, IServiceBusService serviceBusService)
    {
        var success = await serviceBusService.DeleteSubscriptionAsync(connectionId, topicName, subscriptionName);
        if (success)
        {
            return Results.Ok();
        }
        return Results.NotFound("Connection not found");
    }
}
