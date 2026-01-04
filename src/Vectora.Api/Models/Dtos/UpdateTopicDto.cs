namespace Vectora.Api.Models;

public class UpdateTopicDto
{
    public string? Status { get; set; }
    public TimeSpan? DefaultMessageTimeToLive { get; set; }
}
