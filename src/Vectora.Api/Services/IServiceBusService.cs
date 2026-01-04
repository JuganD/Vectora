using Vectora.Api.Models;

namespace Vectora.Api.Services;

public interface IServiceBusService
{
    Task<(List<QueueInfoDto> Queues, List<TopicInfoDto> Topics)?> GetEntitiesAsync(int connectionId);
    Task<QueueInfoDto?> GetQueueRuntimeInfoAsync(int connectionId, string queueName);
    Task<SubscriptionInfoDto?> GetSubscriptionRuntimeInfoAsync(int connectionId, string topicName, string subscriptionName);
    Task<List<ServiceBusMessageDto>?> PeekMessagesAsync(int connectionId, string entityPath, string? subscriptionName, int maxMessages, bool deadLetter, long? fromSequenceNumber = null);
    Task<List<ServiceBusMessageDto>?> ReceiveMessagesAsync(int connectionId, string entityPath, string? subscriptionName, int maxMessages, bool deadLetter);
    Task<int?> ReceiveDeadLetterMessagesBySequenceAsync(int connectionId, string entityPath, string? subscriptionName, IEnumerable<long> sequenceNumbers);
    Task<bool> SendMessageAsync(int connectionId, string entityPath, SendMessageDto message);
    Task<bool?> ReturnDeadLetterMessageAsync(int connectionId, string entityPath, string? subscriptionName, long sequenceNumber, SendMessageDto? modifiedMessage, bool deleteOriginal);
    Task<int?> ReturnDeadLetterMessagesAsync(int connectionId, string entityPath, string? subscriptionName, IEnumerable<long> sequenceNumbers);

    // Entity management - handles emulator vs real Service Bus internally
    Task<QueuePropertiesDto?> GetQueuePropertiesAsync(int connectionId, string queueName);
    Task<TopicPropertiesDto?> GetTopicPropertiesAsync(int connectionId, string topicName);
    Task<SubscriptionPropertiesDto?> GetSubscriptionPropertiesAsync(int connectionId, string topicName, string subscriptionName);
    Task<bool> CreateQueueAsync(int connectionId, CreateQueueDto dto);
    Task<bool> CreateTopicAsync(int connectionId, CreateTopicDto dto);
    Task<bool> CreateSubscriptionAsync(int connectionId, string topicName, CreateSubscriptionDto dto);
    Task<bool> UpdateQueueAsync(int connectionId, string queueName, UpdateQueueDto dto);
    Task<bool> UpdateTopicAsync(int connectionId, string topicName, UpdateTopicDto dto);
    Task<bool> UpdateSubscriptionAsync(int connectionId, string topicName, string subscriptionName, UpdateSubscriptionDto dto);
    Task<bool> DeleteQueueAsync(int connectionId, string queueName);
    Task<bool> DeleteTopicAsync(int connectionId, string topicName);
    Task<bool> DeleteSubscriptionAsync(int connectionId, string topicName, string subscriptionName);
}

