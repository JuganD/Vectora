namespace Vectora.Api.Models;

public class ServiceBusConnection
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string ConnectionString { get; set; }
    public bool IsEmulator { get; set; }
    public int? EmulatorConfigId { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}