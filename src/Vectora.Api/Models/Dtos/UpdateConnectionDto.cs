namespace Vectora.Api.Models;

public class UpdateConnectionDto
{
    public string Name { get; set; } = string.Empty;
    public string? ConnectionString { get; set; }
    public bool IsEmulator { get; set; }
    public int? EmulatorConfigId { get; set; }
}
