namespace Vectora.Api.Models;

public class EmulatorConfigDto
{
    public int Id { get; set; }
    public string FileName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
