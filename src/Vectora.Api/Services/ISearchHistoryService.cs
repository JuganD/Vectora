using Vectora.Api.Models;

namespace Vectora.Api.Services;

public interface ISearchHistoryService
{
    Task<List<SearchHistoryEntry>> GetBySearchKeyAsync(Guid searchKey);
    Task<SearchHistoryEntry?> RecordSearchTermAsync(Guid searchKey, string term);
    Task<SearchHistoryEntry?> SetFavoriteAsync(Guid searchKey, string term, bool isFavorite);
}
