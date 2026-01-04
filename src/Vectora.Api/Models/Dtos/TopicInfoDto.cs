namespace Vectora.Api.Models;

public class TopicInfoDto
{
    public string Name { get; set; } = string.Empty;
    public List<SubscriptionInfoDto> Subscriptions { get; set; } = new();
    public bool IsEmulator { get; set; }
}
