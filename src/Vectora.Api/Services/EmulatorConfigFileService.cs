using Microsoft.EntityFrameworkCore;
using Vectora.Api.Data;
using Vectora.Api.Models;

namespace Vectora.Api.Services;

public class EmulatorConfigFileService : IEmulatorConfigFileService
{
    private readonly VectoraDbContext _db;

    public EmulatorConfigFileService(VectoraDbContext db)
    {
        _db = db;
    }

    public async Task<List<EmulatorConfigFile>> GetAllAsync()
    {
        return await _db.EmulatorConfigs
            .OrderBy(c => c.FileName)
            .ToListAsync();
    }

    public async Task<EmulatorConfigFile?> GetByIdAsync(int id)
    {
        return await _db.EmulatorConfigs.FindAsync(id);
    }

    public async Task<EmulatorConfigFile> CreateOrUpdateAsync(string fileName, string content)
    {
        var existing = await _db.EmulatorConfigs.FirstOrDefaultAsync(c => c.FileName == fileName);
        if (existing != null)
        {
            existing.Content = content;
            existing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return existing;
        }

        var config = new EmulatorConfigFile
        {
            FileName = fileName,
            Content = content
        };
        _db.EmulatorConfigs.Add(config);
        await _db.SaveChangesAsync();
        return config;
    }

    public async Task<bool> DeleteAsync(int id)
    {
        var config = await _db.EmulatorConfigs.FindAsync(id);
        if (config == null)
        {
            return false;
        }

        _db.EmulatorConfigs.Remove(config);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> IsConfigInUseAsync(int id)
    {
        return await _db.Connections.AnyAsync(c => c.EmulatorConfigId == id);
    }
}

