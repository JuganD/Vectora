using System.Collections.Concurrent;
using Vectora.Api.Models;

namespace Vectora.Api.Helpers;

public class ServiceBusEntityCache : IServiceBusEntityCache
{
    private readonly ConcurrentDictionary<int, (List<QueueInfoDto> Queues, List<TopicInfoDto> Topics)> _entries = new();

    public bool TryGet(int connectionId, out (List<QueueInfoDto> Queues, List<TopicInfoDto> Topics) entities)
    {
        return _entries.TryGetValue(connectionId, out entities);
    }

    public void Set(int connectionId, List<QueueInfoDto> queues, List<TopicInfoDto> topics)
    {
        _entries[connectionId] = (queues, topics);
    }

    public void Invalidate(int connectionId)
    {
        _entries.TryRemove(connectionId, out _);
    }
}
