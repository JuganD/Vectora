using Vectora.Api.Services;

namespace Vectora.Api.Middleware;

public class AuthMiddleware
{
    private readonly RequestDelegate _next;
    private readonly bool _authRequired;
    private readonly HashSet<string> _excludedPaths = new(StringComparer.OrdinalIgnoreCase)
    {
        "/api/auth/login",
        "/api/auth/validate",
        "/api/auth/status"
    };

    public AuthMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        var password = configuration["VECTORA_PASSWORD"] ?? Environment.GetEnvironmentVariable("VECTORA_PASSWORD");
        _authRequired = !string.IsNullOrEmpty(password);
    }

    public async Task InvokeAsync(HttpContext context, IJwtService jwtService)
    {
        var path = context.Request.Path.Value ?? "";

        // Skip auth for excluded paths and static files
        if (_excludedPaths.Any(p => path.StartsWith(p, StringComparison.OrdinalIgnoreCase)) ||
            !path.StartsWith("/api", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // If no password is set, skip authentication entirely
        if (!_authRequired)
        {
            await _next(context);
            return;
        }

        // Check for auth token in header
        if (!context.Request.Headers.TryGetValue("Authorization", out var authHeader) ||
            string.IsNullOrEmpty(authHeader))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "Authentication required" });
            return;
        }

        // Extract Bearer token
        var headerValue = authHeader.ToString();
        if (!headerValue.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "Invalid authorization header format" });
            return;
        }

        var token = headerValue.Substring(7);

        // Validate JWT token
        if (!jwtService.ValidateToken(token))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new { error = "Invalid or expired token" });
            return;
        }

        await _next(context);
    }
}
