namespace Vectora.Api.Models;

/// <summary>
/// A read-only view of a subscription rule (filter + optional action). A subscription's
/// rules determine which messages published to the topic are delivered to it, so exposing
/// them lets callers reason about message routing.
/// </summary>
public class SubscriptionRuleDto
{
    public string Name { get; set; } = string.Empty;

    /// <summary>Filter kind: "Sql", "Correlation", "True", "False", or "Unknown".</summary>
    public string FilterType { get; set; } = string.Empty;

    /// <summary>The SQL filter expression, when <see cref="FilterType"/> is "Sql".</summary>
    public string? SqlFilter { get; set; }

    /// <summary>The matched fields of a correlation filter, when <see cref="FilterType"/> is "Correlation".</summary>
    public CorrelationFilterDto? CorrelationFilter { get; set; }

    /// <summary>The SQL rule action expression applied to matching messages, if any.</summary>
    public string? Action { get; set; }
}

public class CorrelationFilterDto
{
    public string? CorrelationId { get; set; }
    public string? MessageId { get; set; }
    public string? To { get; set; }
    public string? ReplyTo { get; set; }
    public string? Subject { get; set; }
    public string? SessionId { get; set; }
    public string? ReplyToSessionId { get; set; }
    public string? ContentType { get; set; }
    public Dictionary<string, object>? ApplicationProperties { get; set; }
}
