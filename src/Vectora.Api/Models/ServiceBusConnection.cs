namespace Vectora.Api.Models;

public class ServiceBusConnection
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string ConnectionString { get; set; }
    public bool IsEmulator { get; set; }
    public int? EmulatorConfigId { get; set; }

    // Unexposed connections are invisible to MCP agents; McpAllowSend additionally permits sending.
    public bool McpExposed { get; set; }
    public bool McpAllowSend { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}