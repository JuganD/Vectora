namespace Vectora.Api.Models;

public class RecordSearchHistoryRequest
{
    public Guid SearchKey { get; set; }
    public string Term { get; set; } = string.Empty;
}
