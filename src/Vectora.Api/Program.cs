using Microsoft.EntityFrameworkCore;
using Vectora.Api.Data;
using Vectora.Api.Endpoints;
using Vectora.Api.Helpers;
using Vectora.Api.Middleware;
using Vectora.Api.Repositories;
using Vectora.Api.Services;

var builder = WebApplication.CreateBuilder(args);

const string DataPath = "/data";

// Configure SQLite database
Directory.CreateDirectory(DataPath);
var dbPath = Path.Combine(DataPath, "vectora.db");
builder.Services.AddDbContext<VectoraDbContext>(options =>
    options.UseSqlite($"Data Source={dbPath}"));

// Add helpers
builder.Services.AddSingleton<IServiceBusClientCache, ServiceBusClientCache>();

// Add repositories
builder.Services.AddScoped<IConnectionRepository, ConnectionRepository>();
builder.Services.AddScoped<ISettingsRepository, SettingsRepository>();

// Add services
builder.Services.AddSingleton<IJwtService, JwtService>();
builder.Services.AddScoped<IEmulatorConfigFileService, EmulatorConfigFileService>();
builder.Services.AddScoped<IEmulatorConfigService, EmulatorConfigService>();
builder.Services.AddScoped<IServiceBusService, ServiceBusService>();
builder.Services.AddScoped<ISettingsService, SettingsService>();

// Configure request body size limit (10MB max)
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 10 * 1024 * 1024; // 10 MB
});

var app = builder.Build();

// Initialize database with migrations
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<VectoraDbContext>();
    db.Database.Migrate();
}

// Configure the HTTP request pipeline - order matters!

// 1. Global exception handling (first to catch all errors)
app.UseMiddleware<ExceptionHandlingMiddleware>();

// 2. Security headers
app.UseMiddleware<SecurityHeadersMiddleware>();

// 3. Rate limiting for login
app.UseMiddleware<LoginRateLimitingMiddleware>();

// 4. Serve static files (frontend)
app.UseDefaultFiles();
app.UseStaticFiles();

// 5. Authentication middleware
app.UseMiddleware<AuthMiddleware>();

// Map minimal API endpoints
app.MapAuthEndpoints();
app.MapConnectionEndpoints();
app.MapEmulatorConfigEndpoints();
app.MapServiceBusEndpoints();
app.MapServiceBusMessageEndpoints();
app.MapSettingsEndpoints();

// Fallback to index.html for SPA routing
app.MapFallbackToFile("index.html");

app.Run();
