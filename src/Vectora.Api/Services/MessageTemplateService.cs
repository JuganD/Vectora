using Microsoft.EntityFrameworkCore;
using Vectora.Api.Data;
using Vectora.Api.Models;

namespace Vectora.Api.Services;

public class MessageTemplateService : IMessageTemplateService
{
    private readonly VectoraDbContext _db;

    public MessageTemplateService(VectoraDbContext db)
    {
        _db = db;
    }

    public async Task<List<MessageTemplate>> GetAllAsync()
    {
        return await _db.MessageTemplates
            .OrderBy(t => t.Name)
            .ToListAsync();
    }

    public async Task<MessageTemplate?> GetByIdAsync(int id)
    {
        return await _db.MessageTemplates.FindAsync(id);
    }

    public async Task<MessageTemplate> CreateOrUpdateAsync(SaveMessageTemplateDto dto)
    {
        var existing = await _db.MessageTemplates.FirstOrDefaultAsync(t => t.Name == dto.Name);
        if (existing != null)
        {
            existing.Body = dto.Body;
            existing.ContentType = dto.ContentType;
            existing.Subject = dto.Subject;
            existing.MessageId = dto.MessageId;
            existing.CorrelationId = dto.CorrelationId;
            existing.SessionId = dto.SessionId;
            existing.ApplicationProperties = dto.ApplicationProperties;
            existing.SendMultiple = dto.SendMultiple;
            existing.SendCount = dto.SendCount;
            existing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return existing;
        }

        var template = new MessageTemplate
        {
            Name = dto.Name,
            Body = dto.Body,
            ContentType = dto.ContentType,
            Subject = dto.Subject,
            MessageId = dto.MessageId,
            CorrelationId = dto.CorrelationId,
            SessionId = dto.SessionId,
            ApplicationProperties = dto.ApplicationProperties,
            SendMultiple = dto.SendMultiple,
            SendCount = dto.SendCount,
        };
        _db.MessageTemplates.Add(template);
        await _db.SaveChangesAsync();
        return template;
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var template = await _db.MessageTemplates.FindAsync(id);
        if (template == null)
        {
            return false;
        }

        _db.MessageTemplates.Remove(template);
        await _db.SaveChangesAsync();
        return true;
    }
}

