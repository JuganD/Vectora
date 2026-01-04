namespace Vectora.Api.Middleware;

public class RateLimitEntry
{
    public int AttemptCount { get; set; }
    public DateTime WindowStart { get; set; }
    public DateTime? LockedUntil { get; set; }
}

