namespace Vectora.Api.Models;

public class SubscriptionInfoDto
{
    public string Name { get; set; } = string.Empty;
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
}
