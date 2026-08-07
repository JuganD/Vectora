using Vectora.Api.Models;

namespace Vectora.Api.Helpers;

public interface IServiceBusEntityCache
{
    bool TryGet(int connectionId, out (List<QueueInfoDto> Queues, List<TopicInfoDto> Topics, bool SupportsManagement) entities);
    void Set(int connectionId, List<QueueInfoDto> queues, List<TopicInfoDto> topics, bool supportsManagement);
    void Invalidate(int connectionId);
}
