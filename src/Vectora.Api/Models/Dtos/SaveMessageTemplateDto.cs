namespace Vectora.Api.Models;

public class SaveMessageTemplateDto
{
    public string Name { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public string? Subject { get; set; }
    public string? MessageId { get; set; }
    public string? CorrelationId { get; set; }
    public string? SessionId { get; set; }
    public string? ApplicationProperties { get; set; }
    public bool SendMultiple { get; set; }
    public int SendCount { get; set; } = 5;
}

