using Vectora.Api.Models;

namespace Vectora.Api.Helpers;

public interface IServiceBusEntityCache
{
    bool TryGet(int connectionId, out (List<QueueInfoDto> Queues, List<TopicInfoDto> Topics) entities);
    void Set(int connectionId, List<QueueInfoDto> queues, List<TopicInfoDto> topics);
    void Invalidate(int connectionId);
}
