using Vectora.Api.Repositories;

namespace Vectora.Api.Services;

// Runs once at startup: refreshes every connection's entities so the server entity cache is
// warm before the first request. Failures per connection are logged and skipped.
public class EntityCacheWarmupService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<EntityCacheWarmupService> _logger;

    public EntityCacheWarmupService(IServiceScopeFactory scopeFactory, ILogger<EntityCacheWarmupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var connectionRepository = scope.ServiceProvider.GetRequiredService<IConnectionRepository>();
            var serviceBusService = scope.ServiceProvider.GetRequiredService<IServiceBusService>();

            var connections = await connectionRepository.GetAllAsync();
            if (connections.Count == 0)
            {
                return;
            }

            _logger.LogInformation("Warming entity cache for {Count} connection(s) at startup.", connections.Count);

            foreach (var connection in connections)
            {
                if (stoppingToken.IsCancellationRequested)
                {
                    break;
                }

                try
                {
                    await serviceBusService.GetEntitiesAsync(connection.Id, refreshCache: true, stoppingToken);
                    _logger.LogInformation("Warmed entity cache for connection '{Name}' (id {Id}).", connection.Name, connection.Id);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to warm entity cache for connection '{Name}' (id {Id}).", connection.Name, connection.Id);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Entity cache warmup failed.");
        }
    }
}
