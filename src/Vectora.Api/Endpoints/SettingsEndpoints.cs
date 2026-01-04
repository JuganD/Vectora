using Microsoft.AspNetCore.Mvc;
using Vectora.Api.Helpers;
using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings").WithTags("Settings");

        group.MapGet("/", GetSettings).WithName("GetSettings");
        group.MapPut("/", UpdateSettings).WithName("UpdateSettings");
    }

    private static async Task<IResult> GetSettings(ISettingsService settingsService)
    {
        var timeout = await settingsService.GetBatchOperationTimeoutSecondsAsync();
        return Results.Ok(new
        {
            batchOperationTimeoutSeconds = timeout
        });
    }

    private static async Task<IResult> UpdateSettings([FromBody] UpdateSettingsRequest request, ISettingsService settingsService)
    {
        // Validate input
        var (valid, error) = ValidationHelper.ValidateBatchTimeout(request.BatchOperationTimeoutSeconds);
        if (!valid)
        {
            return Results.BadRequest(new { error });
        }

        if (request.BatchOperationTimeoutSeconds.HasValue)
        {
            await settingsService.SetBatchOperationTimeoutSecondsAsync(request.BatchOperationTimeoutSeconds.Value);
        }
        var timeout = await settingsService.GetBatchOperationTimeoutSecondsAsync();
        return Results.Ok(new
        {
            batchOperationTimeoutSeconds = timeout
        });
    }
}

