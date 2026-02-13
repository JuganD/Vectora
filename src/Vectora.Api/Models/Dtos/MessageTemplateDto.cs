namespace Vectora.Api.Models;

public class MessageTemplateDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public string? Subject { get; set; }
    public string? MessageId { get; set; }
    public string? CorrelationId { get; set; }
    public string? SessionId { get; set; }
    public string? ApplicationProperties { get; set; }
    public bool SendMultiple { get; set; }
    public int SendCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

