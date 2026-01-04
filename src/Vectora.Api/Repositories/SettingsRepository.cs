using Microsoft.EntityFrameworkCore;
using Vectora.Api.Data;
using Vectora.Api.Models;

namespace Vectora.Api.Repositories;

public class SettingsRepository : ISettingsRepository
{
    private readonly VectoraDbContext _context;

    public SettingsRepository(VectoraDbContext context)
    {
        _context = context;
    }

    public async Task<string?> GetValueAsync(string key)
    {
        var setting = await _context.Settings.FirstOrDefaultAsync(s => s.Key == key);
        return setting?.Value;
    }

    public async Task SetValueAsync(string key, string value)
    {
        var setting = await _context.Settings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null)
        {
            setting = new Setting { Key = key, Value = value };
            _context.Settings.Add(setting);
        }
        else
        {
            setting.Value = value;
        }
        await _context.SaveChangesAsync();
    }

    public async Task<int> GetIntAsync(string key, int defaultValue)
    {
        var value = await GetValueAsync(key);
        return int.TryParse(value, out var result) ? result : defaultValue;
    }

    public async Task SetIntAsync(string key, int value)
    {
        await SetValueAsync(key, value.ToString());
    }
}

