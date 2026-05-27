namespace Vectora.Api.Models;

public class QueueInfoDto
{
    public string Name { get; set; } = string.Empty;
    public long ActiveMessageCount { get; set; }
    public long DeadLetterMessageCount { get; set; }
    public bool IsEmulator { get; set; }
    public bool RequiresSession { get; set; }
}
