using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class SearchHistoryEndpoints
{
    public static void MapSearchHistoryEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/search-history").WithTags("SearchHistory");

        group.MapGet("/{searchKey:guid}", GetByKey)
            .WithName("GetSearchHistoryByKey");

        group.MapPost("/", RecordSearch)
            .WithName("RecordSearchHistory");

        group.MapPut("/favorite", SetFavorite)
            .WithName("SetSearchHistoryFavorite");

        group.MapDelete("/", DeleteSearch)
            .WithName("DeleteSearchHistory");
    }

    private static async Task<IResult> GetByKey(Guid searchKey, ISearchHistoryService service)
    {
        var entries = await service.GetBySearchKeyAsync(searchKey);
        return Results.Ok(entries.Select(MapToDto));
    }

    private static async Task<IResult> RecordSearch(RecordSearchHistoryRequest request, ISearchHistoryService service)
    {
        if (string.IsNullOrWhiteSpace(request.Term))
        {
            return Results.BadRequest(new { error = "Search term is required" });
        }

        var entry = await service.RecordSearchTermAsync(request.SearchKey, request.Term);
        if (entry == null)
        {
            return Results.BadRequest(new { error = "Search term is required" });
        }

        return Results.Ok(MapToDto(entry));
    }

    private static async Task<IResult> SetFavorite(SetSearchFavoriteRequest request, ISearchHistoryService service)
    {
        if (string.IsNullOrWhiteSpace(request.Term))
        {
            return Results.BadRequest(new { error = "Search term is required" });
        }

        var entry = await service.SetFavoriteAsync(request.SearchKey, request.Term, request.IsFavorite);
        if (entry == null)
        {
            return Results.NotFound();
        }

        return Results.Ok(MapToDto(entry));
    }

    private static async Task<IResult> DeleteSearch(Guid searchKey, string term, ISearchHistoryService service)
    {
        if (string.IsNullOrWhiteSpace(term))
        {
            return Results.BadRequest(new { error = "Search term is required" });
        }

        var deleted = await service.DeleteAsync(searchKey, term);
        if (!deleted)
        {
            return Results.NotFound();
        }

        return Results.NoContent();
    }

    private static SearchHistoryEntryDto MapToDto(SearchHistoryEntry entry)
    {
        return new SearchHistoryEntryDto
        {
            Term = entry.Term,
            IsFavorite = entry.IsFavorite,
            LastSearchedAt = entry.LastSearchedAt,
        };
    }
}
