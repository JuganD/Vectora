using Vectora.Api.Models;

namespace Vectora.Api.Services;

public interface IMessageTemplateService
{
    Task<List<MessageTemplate>> GetAllAsync();
    Task<MessageTemplate?> GetByIdAsync(int id);
    Task<MessageTemplate> CreateOrUpdateAsync(SaveMessageTemplateDto dto);
    Task<bool> DeleteAsync(int id);
}

