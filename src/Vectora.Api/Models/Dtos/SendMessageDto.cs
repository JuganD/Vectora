using System.Text.Json;

namespace Vectora.Api.Models;

public class SendMessageDto
{
    public string Body { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public string? Subject { get; set; }
    public string? MessageId { get; set; }
    public string? CorrelationId { get; set; }
    public string? ReplyTo { get; set; }
    public string? ReplyToSessionId { get; set; }
    public string? SessionId { get; set; }
    public string? To { get; set; }
    public DateTimeOffset? ScheduledEnqueueTime { get; set; }
    public TimeSpan? TimeToLive { get; set; }
    // Each value is either a bare JSON value (string/number/bool) or a { value, type } object
    // for an explicit type — see ApplicationPropertyConverter for the supported type names.
    public Dictionary<string, JsonElement>? ApplicationProperties { get; set; }
}
