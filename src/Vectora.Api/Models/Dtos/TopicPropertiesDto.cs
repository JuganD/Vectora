namespace Vectora.Api.Models;

public class TopicPropertiesDto
{
    public string Name { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public TimeSpan DefaultMessageTimeToLive { get; set; }
    public bool RequiresDuplicateDetection { get; set; }
    public long MaxSizeInMegabytes { get; set; }
}
