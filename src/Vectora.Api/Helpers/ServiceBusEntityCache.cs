using System.Collections.Concurrent;
using Vectora.Api.Models;

namespace Vectora.Api.Helpers;

public class ServiceBusEntityCache : IServiceBusEntityCache
{
    private readonly ConcurrentDictionary<int, (List<QueueInfoDto> Queues, List<TopicInfoDto> Topics, bool SupportsManagement)> _entries = new();

    public bool TryGet(int connectionId, out (List<QueueInfoDto> Queues, List<TopicInfoDto> Topics, bool SupportsManagement) entities)
    {
        return _entries.TryGetValue(connectionId, out entities);
    }

    public void Set(int connectionId, List<QueueInfoDto> queues, List<TopicInfoDto> topics, bool supportsManagement)
    {
        _entries[connectionId] = (queues, topics, supportsManagement);
    }

    public void Invalidate(int connectionId)
    {
        _entries.TryRemove(connectionId, out _);
    }
}
