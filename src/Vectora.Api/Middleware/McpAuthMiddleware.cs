using System.Security.Cryptography;
using System.Text;
using Vectora.Api.Services;

namespace Vectora.Api.Middleware;

// Gates /mcp independently of the SPA's VECTORA_PASSWORD auth. The enable flag and optional
// bearer key are read from the DB on every request, so Settings changes apply without a restart.
public class McpAuthMiddleware
{
    private const string McpPathPrefix = "/mcp";
    private readonly RequestDelegate _next;

    public McpAuthMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ISettingsService settingsService)
    {
        var path = context.Request.Path.Value ?? "";
        if (!path.StartsWith(McpPathPrefix, StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // When disabled, the endpoint should look like it doesn't exist at all.
        if (!await settingsService.GetMcpEnabledAsync())
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var apiKey = await settingsService.GetMcpApiKeyAsync();
        if (string.IsNullOrEmpty(apiKey))
        {
            await _next(context);
            return;
        }

        if (!context.Request.Headers.TryGetValue("Authorization", out var authHeader))
        {
            await WriteUnauthorizedAsync(context);
            return;
        }

        var headerValue = authHeader.ToString();
        if (!headerValue.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            await WriteUnauthorizedAsync(context);
            return;
        }

        var providedKey = headerValue.Substring("Bearer ".Length).Trim();

        // Timing-safe comparison, mirroring the password check in AuthEndpoints.
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(apiKey!));
        var providedHash = SHA256.HashData(Encoding.UTF8.GetBytes(providedKey));
        if (!CryptographicOperations.FixedTimeEquals(providedHash, expectedHash))
        {
            await WriteUnauthorizedAsync(context);
            return;
        }

        await _next(context);
    }

    private static async Task WriteUnauthorizedAsync(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.Headers["WWW-Authenticate"] = "Bearer";
        await context.Response.WriteAsJsonAsync(new { error = "Invalid or missing MCP API key" });
    }
}
