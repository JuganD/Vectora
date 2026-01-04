using Vectora.Api.Helpers;
using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class EmulatorConfigEndpoints
{
    public static void MapEmulatorConfigEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/emulator-configs").WithTags("EmulatorConfigs");

        group.MapGet("/", GetAll)
            .WithName("GetAllEmulatorConfigs");

        group.MapGet("/{id:int}", GetById)
            .WithName("GetEmulatorConfigById");

        group.MapPost("/", Upload)
            .WithName("UploadEmulatorConfig");

        group.MapDelete("/{id:int}", Delete)
            .WithName("DeleteEmulatorConfig");
    }

    private static async Task<IResult> GetAll(IEmulatorConfigFileService configFileService)
    {
        var configs = await configFileService.GetAllAsync();
        var dtos = configs.Select(c => new EmulatorConfigDto
        {
            Id = c.Id,
            FileName = c.FileName,
            CreatedAt = c.CreatedAt,
            UpdatedAt = c.UpdatedAt
        }).ToList();
        return Results.Ok(dtos);
    }

    private static async Task<IResult> GetById(int id, IEmulatorConfigFileService configFileService)
    {
        var config = await configFileService.GetByIdAsync(id);
        if (config == null)
        {
            return Results.NotFound();
        }

        return Results.Ok(config);
    }

    private static async Task<IResult> Upload(UploadEmulatorConfigDto dto, IEmulatorConfigFileService configFileService)
    {
        // Validate input
        var (nameValid, nameError) = ValidationHelper.ValidateConnectionName(dto.FileName);
        if (!nameValid)
        {
            return Results.BadRequest(new { error = nameError });
        }

        var (contentValid, contentError) = ValidationHelper.ValidateConfigContent(dto.Content);
        if (!contentValid)
        {
            return Results.BadRequest(new { error = contentError });
        }

        var config = await configFileService.CreateOrUpdateAsync(dto.FileName, dto.Content);
        var result = new EmulatorConfigDto
        {
            Id = config.Id,
            FileName = config.FileName,
            CreatedAt = config.CreatedAt,
            UpdatedAt = config.UpdatedAt
        };

        return Results.Created($"/api/emulator-configs/{config.Id}", result);
    }

    private static async Task<IResult> Delete(int id, IEmulatorConfigFileService configFileService)
    {
        var config = await configFileService.GetByIdAsync(id);
        if (config == null)
        {
            return Results.NotFound();
        }

        // Check if any connection is using this config
        var inUse = await configFileService.IsConfigInUseAsync(id);
        if (inUse)
        {
            return Results.BadRequest(new { error = "Config is in use by a connection" });
        }

        await configFileService.DeleteAsync(id);
        return Results.NoContent();
    }
}

