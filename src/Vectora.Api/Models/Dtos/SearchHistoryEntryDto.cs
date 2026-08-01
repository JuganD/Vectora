namespace Vectora.Api.Models;

public class SearchHistoryEntryDto
{
    public string Term { get; set; } = string.Empty;
    public bool IsFavorite { get; set; }
    public DateTime LastSearchedAt { get; set; }
}
