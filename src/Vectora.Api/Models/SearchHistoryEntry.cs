namespace Vectora.Api.Models;

public class SearchHistoryEntry
{
    public int Id { get; set; }
    public Guid SearchKey { get; set; }
    public required string Term { get; set; }
    public bool IsFavorite { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastSearchedAt { get; set; } = DateTime.UtcNow;
}
