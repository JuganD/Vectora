namespace Vectora.Api.Models;

public class MessageTemplate
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Body { get; set; }
    public string? ContentType { get; set; }
    public string? Subject { get; set; }
    public string? MessageId { get; set; }
    public string? CorrelationId { get; set; }
    public string? SessionId { get; set; }
    public string? ApplicationProperties { get; set; } // JSON serialized
    public bool SendMultiple { get; set; }
    public int SendCount { get; set; } = 5;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

