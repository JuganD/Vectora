using System.Text.Json;
using Vectora.Api.Data;
using Vectora.Api.Models;

namespace Vectora.Api.Services;

public class EmulatorConfigService : IEmulatorConfigService
{
    private readonly VectoraDbContext _db;
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = null
    };

    public EmulatorConfigService(VectoraDbContext db)
    {
        _db = db;
    }

    public async Task<EmulatorConfig?> LoadConfigAsync(int configId)
    {
        var configFile = await _db.EmulatorConfigs.FindAsync(configId);
        if (configFile == null)
        {
            return null;
        }
        return JsonSerializer.Deserialize<EmulatorConfig>(configFile.Content, _jsonOptions);
    }

    public async Task SaveConfigAsync(int configId, EmulatorConfig config)
    {
        var configFile = await _db.EmulatorConfigs.FindAsync(configId);
        if (configFile == null)
        {
            return;
        }
        configFile.Content = JsonSerializer.Serialize(config, _jsonOptions);
        configFile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
    }

    public async Task<List<(string Name, bool RequiresSession)>> GetQueuesFromConfigAsync(int configId)
    {
        var config = await LoadConfigAsync(configId);
        return config?.UserConfig.Namespaces
            .SelectMany(n => n.Queues.Select(q => (q.Name, q.Properties.RequiresSession)))
            .ToList() ?? new List<(string, bool)>();
    }

    public async Task<List<(string TopicName, List<(string Name, bool RequiresSession)> Subscriptions)>> GetTopicsFromConfigAsync(int configId)
    {
        var config = await LoadConfigAsync(configId);
        return config?.UserConfig.Namespaces
            .SelectMany(n => n.Topics.Select(t => (t.Name, t.Subscriptions.Select(s => (s.Name, s.Properties.RequiresSession)).ToList())))
            .ToList() ?? new List<(string, List<(string, bool)>)>();
    }

    public async Task AddQueueToConfigAsync(int configId, string queueName, EmulatorQueueProperties? properties = null)
    {
        var config = await LoadConfigAsync(configId) ?? new EmulatorConfig();
        var ns = config.UserConfig.Namespaces.FirstOrDefault() ?? new EmulatorNamespace { Name = "sbemulatorns" };
        if (!config.UserConfig.Namespaces.Contains(ns))
        {
            config.UserConfig.Namespaces.Add(ns);
        }

        ns.Queues.Add(new EmulatorQueue { Name = queueName, Properties = properties ?? new EmulatorQueueProperties() });
        await SaveConfigAsync(configId, config);
    }

    public async Task AddTopicToConfigAsync(int configId, string topicName, EmulatorTopicProperties? properties = null)
    {
        var config = await LoadConfigAsync(configId) ?? new EmulatorConfig();
        var ns = config.UserConfig.Namespaces.FirstOrDefault() ?? new EmulatorNamespace { Name = "sbemulatorns" };
        if (!config.UserConfig.Namespaces.Contains(ns))
        {
            config.UserConfig.Namespaces.Add(ns);
        }

        ns.Topics.Add(new EmulatorTopic { Name = topicName, Properties = properties ?? new EmulatorTopicProperties() });
        await SaveConfigAsync(configId, config);
    }

    public async Task AddSubscriptionToConfigAsync(int configId, string topicName, string subscriptionName, EmulatorSubscriptionProperties? properties = null)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }

        var topic = config.UserConfig.Namespaces.SelectMany(n => n.Topics).FirstOrDefault(t => t.Name == topicName);
        if (topic == null)
        {
            return;
        }

        topic.Subscriptions.Add(new EmulatorSubscription { Name = subscriptionName, Properties = properties ?? new EmulatorSubscriptionProperties() });
        await SaveConfigAsync(configId, config);
    }

    public async Task UpdateQueueInConfigAsync(int configId, string queueName, EmulatorQueueProperties properties)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }
        var queue = config.UserConfig.Namespaces.SelectMany(n => n.Queues).FirstOrDefault(q => q.Name == queueName);
        if (queue == null)
        {
            return;
        }
        queue.Properties = properties;
        await SaveConfigAsync(configId, config);
    }

    public async Task UpdateTopicInConfigAsync(int configId, string topicName, EmulatorTopicProperties properties)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }
        var topic = config.UserConfig.Namespaces.SelectMany(n => n.Topics).FirstOrDefault(t => t.Name == topicName);
        if (topic == null)
        {
            return;
        }
        topic.Properties = properties;
        await SaveConfigAsync(configId, config);
    }

    public async Task UpdateSubscriptionInConfigAsync(int configId, string topicName, string subscriptionName, EmulatorSubscriptionProperties properties)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }
        var topic = config.UserConfig.Namespaces.SelectMany(n => n.Topics).FirstOrDefault(t => t.Name == topicName);
        var sub = topic?.Subscriptions.FirstOrDefault(s => s.Name == subscriptionName);
        if (sub == null)
        {
            return;
        }
        sub.Properties = properties;
        await SaveConfigAsync(configId, config);
    }

    public async Task DeleteQueueFromConfigAsync(int configId, string queueName)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }
        foreach (var ns in config.UserConfig.Namespaces)
        {
            ns.Queues.RemoveAll(q => q.Name == queueName);
        }
        await SaveConfigAsync(configId, config);
    }

    public async Task DeleteTopicFromConfigAsync(int configId, string topicName)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }
        foreach (var ns in config.UserConfig.Namespaces)
        {
            ns.Topics.RemoveAll(t => t.Name == topicName);
        }
        await SaveConfigAsync(configId, config);
    }

    public async Task DeleteSubscriptionFromConfigAsync(int configId, string topicName, string subscriptionName)
    {
        var config = await LoadConfigAsync(configId);
        if (config == null)
        {
            return;
        }
        var topic = config.UserConfig.Namespaces.SelectMany(n => n.Topics).FirstOrDefault(t => t.Name == topicName);
        topic?.Subscriptions.RemoveAll(s => s.Name == subscriptionName);
        await SaveConfigAsync(configId, config);
    }
}
