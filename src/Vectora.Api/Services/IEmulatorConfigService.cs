using Vectora.Api.Models;

namespace Vectora.Api.Services;

public interface IEmulatorConfigService
{
    Task<EmulatorConfig?> LoadConfigAsync(int configId);
    Task SaveConfigAsync(int configId, EmulatorConfig config);
    Task<List<string>> GetQueuesFromConfigAsync(int configId);
    Task<List<(string TopicName, List<string> Subscriptions)>> GetTopicsFromConfigAsync(int configId);
    Task AddQueueToConfigAsync(int configId, string queueName, EmulatorQueueProperties? properties = null);
    Task AddTopicToConfigAsync(int configId, string topicName, EmulatorTopicProperties? properties = null);
    Task AddSubscriptionToConfigAsync(int configId, string topicName, string subscriptionName, EmulatorSubscriptionProperties? properties = null);
    Task UpdateQueueInConfigAsync(int configId, string queueName, EmulatorQueueProperties properties);
    Task UpdateTopicInConfigAsync(int configId, string topicName, EmulatorTopicProperties properties);
    Task UpdateSubscriptionInConfigAsync(int configId, string topicName, string subscriptionName, EmulatorSubscriptionProperties properties);
    Task DeleteQueueFromConfigAsync(int configId, string queueName);
    Task DeleteTopicFromConfigAsync(int configId, string topicName);
    Task DeleteSubscriptionFromConfigAsync(int configId, string topicName, string subscriptionName);
}

