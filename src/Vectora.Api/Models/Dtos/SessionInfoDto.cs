namespace Vectora.Api.Models;

public class SessionInfoDto
{
    public string SessionId { get; set; } = string.Empty;
    public long MessageCount { get; set; }
    public DateTimeOffset? LastEnqueuedTime { get; set; }
}
