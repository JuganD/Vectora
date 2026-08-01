namespace Vectora.Api.Models;

public class SetSearchFavoriteRequest
{
    public Guid SearchKey { get; set; }
    public string Term { get; set; } = string.Empty;
    public bool IsFavorite { get; set; }
}
