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
            await WriteAuthFailureAsync(context, "Authentication required");
            return;
        }

        // Extract Bearer token
        var headerValue = authHeader.ToString();
        if (!headerValue.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            await WriteAuthFailureAsync(context, "Invalid authorization header format");
            return;
        }

        var token = headerValue.Substring(7);

        // Validate JWT token
        if (!jwtService.ValidateToken(token))
        {
            await WriteAuthFailureAsync(context, "Invalid or expired token");
            return;
        }

        await _next(context);
    }

    // Marks a 401 as coming from the app's own authentication layer (expired/missing JWT) rather
    // than from a downstream resource. The SPA only clears its token and reloads on this signal,
    // so an unrelated 401 can never trap the user in a reload loop.
    private static async Task WriteAuthFailureAsync(HttpContext context, string error)
    {
        context.Response.StatusCode = 401;
        context.Response.Headers["X-Auth-Failure"] = "1";
        await context.Response.WriteAsJsonAsync(new { error });
    }
}
