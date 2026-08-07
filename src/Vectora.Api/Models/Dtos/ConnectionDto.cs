namespace Vectora.Api.Models;

public class ConnectionDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ConnectionString { get; set; } = string.Empty;
    public bool IsEmulator { get; set; }
    public bool McpExposed { get; set; }
    public bool McpAllowSend { get; set; }
    public int SortOrder { get; set; }
}
