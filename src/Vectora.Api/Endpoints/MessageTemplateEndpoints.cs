using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class MessageTemplateEndpoints
{
    public static void MapMessageTemplateEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/message-templates").WithTags("MessageTemplates");

        group.MapGet("/", GetAll)
            .WithName("GetAllMessageTemplates");

        group.MapGet("/{id:int}", GetById)
            .WithName("GetMessageTemplateById");

        group.MapPost("/", CreateOrUpdate)
            .WithName("CreateOrUpdateMessageTemplate");

        group.MapDelete("/{id:int}", Delete)
            .WithName("DeleteMessageTemplate");
    }

    private static async Task<IResult> GetAll(IMessageTemplateService service)
    {
        var templates = await service.GetAllAsync();
        var dtos = templates.Select(t => MapToDto(t)).ToList();
        return Results.Ok(dtos);
    }

    private static async Task<IResult> GetById(int id, IMessageTemplateService service)
    {
        var template = await service.GetByIdAsync(id);
        if (template == null)
        {
            return Results.NotFound();
        }
        return Results.Ok(MapToDto(template));
    }

    private static async Task<IResult> CreateOrUpdate(SaveMessageTemplateDto dto, IMessageTemplateService service)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
        {
            return Results.BadRequest(new { error = "Template name is required" });
        }

        if (string.IsNullOrWhiteSpace(dto.Body))
        {
            return Results.BadRequest(new { error = "Template body is required" });
        }

        var template = await service.CreateOrUpdateAsync(dto);
        return Results.Ok(MapToDto(template));
    }

    private static async Task<IResult> Delete(int id, IMessageTemplateService service)
    {
        var deleted = await service.DeleteAsync(id);
        if (!deleted)
        {
            return Results.NotFound();
        }
        return Results.NoContent();
    }

    private static MessageTemplateDto MapToDto(MessageTemplate t) => new()
    {
        Id = t.Id,
        Name = t.Name,
        Body = t.Body,
        ContentType = t.ContentType,
        Subject = t.Subject,
        MessageId = t.MessageId,
        CorrelationId = t.CorrelationId,
        SessionId = t.SessionId,
        ApplicationProperties = t.ApplicationProperties,
        SendMultiple = t.SendMultiple,
        SendCount = t.SendCount,
        CreatedAt = t.CreatedAt,
        UpdatedAt = t.UpdatedAt,
    };
}

