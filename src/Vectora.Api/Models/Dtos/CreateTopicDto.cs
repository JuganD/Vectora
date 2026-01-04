namespace Vectora.Api.Models;

public class CreateTopicDto
{
    public string Name { get; set; } = string.Empty;
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
    public bool? RequiresDuplicateDetection { get; set; }
}
