using Microsoft.EntityFrameworkCore;
using Vectora.Api.Data;
using Vectora.Api.Models;

namespace Vectora.Api.Services;

public class SearchHistoryService : ISearchHistoryService
{
    private const int NonFavoriteHistoryLimit = 10;
    private readonly VectoraDbContext _db;

    public SearchHistoryService(VectoraDbContext db)
    {
        _db = db;
    }

    public async Task<List<SearchHistoryEntry>> GetBySearchKeyAsync(Guid searchKey)
    {
        var entries = await _db.SearchHistoryEntries
            .Where(x => x.SearchKey == searchKey)
            .ToListAsync();

        var favorites = entries
            .Where(x => x.IsFavorite)
            .OrderBy(x => x.Term);
        var nonFavorites = entries
            .Where(x => !x.IsFavorite)
            .OrderByDescending(x => x.LastSearchedAt)
            .ThenBy(x => x.Term)
            .Take(NonFavoriteHistoryLimit);

        return favorites.Concat(nonFavorites).ToList();
    }

    public async Task<SearchHistoryEntry?> RecordSearchTermAsync(Guid searchKey, string term)
    {
        var trimmed = term.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return null;
        }

        var entry = await _db.SearchHistoryEntries
            .FirstOrDefaultAsync(x => x.SearchKey == searchKey && x.Term == trimmed);

        if (entry == null)
        {
            entry = new SearchHistoryEntry
            {
                SearchKey = searchKey,
                Term = trimmed,
                IsFavorite = false,
                LastSearchedAt = DateTime.UtcNow,
            };
            _db.SearchHistoryEntries.Add(entry);
        }
        else
        {
            entry.Term = trimmed;
            entry.LastSearchedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        await TrimNonFavoriteHistoryAsync(searchKey);
        return entry;
    }

    public async Task<SearchHistoryEntry?> SetFavoriteAsync(Guid searchKey, string term, bool isFavorite)
    {
        var trimmed = term.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return null;
        }

        var entry = await _db.SearchHistoryEntries
            .FirstOrDefaultAsync(x => x.SearchKey == searchKey && x.Term == trimmed);

        if (entry == null)
        {
            return null;
        }

        entry.IsFavorite = isFavorite;
        entry.LastSearchedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        await TrimNonFavoriteHistoryAsync(searchKey);
        return entry;
    }

    public async Task<bool> DeleteAsync(Guid searchKey, string term)
    {
        var trimmed = term.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return false;
        }

        var entry = await _db.SearchHistoryEntries
            .FirstOrDefaultAsync(x => x.SearchKey == searchKey && x.Term == trimmed);

        if (entry == null)
        {
            return false;
        }

        _db.SearchHistoryEntries.Remove(entry);
        await _db.SaveChangesAsync();
        return true;
    }

    private async Task TrimNonFavoriteHistoryAsync(Guid searchKey)
    {
        var staleEntries = await _db.SearchHistoryEntries
            .Where(x => x.SearchKey == searchKey && !x.IsFavorite)
            .OrderByDescending(x => x.LastSearchedAt)
            .ThenBy(x => x.Term)
            .Skip(NonFavoriteHistoryLimit)
            .ToListAsync();

        if (staleEntries.Count == 0)
        {
            return;
        }

        _db.SearchHistoryEntries.RemoveRange(staleEntries);
        await _db.SaveChangesAsync();
    }
}
