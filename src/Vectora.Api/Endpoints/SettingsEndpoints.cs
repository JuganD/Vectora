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
        return Results.Ok(await BuildResponseAsync(settingsService));
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

        if (request.McpEnabled.HasValue)
        {
            await settingsService.SetMcpEnabledAsync(request.McpEnabled.Value);
        }

        // Null leaves the key untouched; any supplied value (including empty, which clears it) is stored.
        if (request.McpApiKey != null)
        {
            await settingsService.SetMcpApiKeyAsync(request.McpApiKey);
        }

        if (request.TourGuideCompletedStep.HasValue)
        {
            await settingsService.SetTourGuideCompletedStepAsync(request.TourGuideCompletedStep.Value);
        }

        return Results.Ok(await BuildResponseAsync(settingsService));
    }

    private static async Task<object> BuildResponseAsync(ISettingsService settingsService)
    {
        return new
        {
            batchOperationTimeoutSeconds = await settingsService.GetBatchOperationTimeoutSecondsAsync(),
            mcpEnabled = await settingsService.GetMcpEnabledAsync(),
            // The raw key is returned so the UI can display and edit it; empty string means no key.
            mcpApiKey = await settingsService.GetMcpApiKeyAsync() ?? string.Empty,
            tourGuideCompletedStep = await settingsService.GetTourGuideCompletedStepAsync()
        };
    }
}

