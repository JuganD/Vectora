namespace Vectora.Api.Models;

public class EmulatorConfigFile
{
    public int Id { get; set; }
    public required string FileName { get; set; }
    public required string Content { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}