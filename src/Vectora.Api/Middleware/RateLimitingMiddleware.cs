using System.Collections.Concurrent;

namespace Vectora.Api.Middleware;

/// <summary>
/// Simple in-memory rate limiting for login attempts to prevent brute force attacks.
/// </summary>
public class LoginRateLimitingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ConcurrentDictionary<string, RateLimitEntry> _attempts = new();
    private readonly int _maxAttempts;
    private readonly TimeSpan _windowDuration;
    private readonly TimeSpan _lockoutDuration;

    public LoginRateLimitingMiddleware(RequestDelegate next, IConfiguration configuration)
    {
        _next = next;
        _maxAttempts = configuration.GetValue("RateLimit:MaxLoginAttempts", 5);
        _windowDuration = TimeSpan.FromMinutes(configuration.GetValue("RateLimit:WindowMinutes", 5));
        _lockoutDuration = TimeSpan.FromMinutes(configuration.GetValue("RateLimit:LockoutMinutes", 15));
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        // Only apply rate limiting to login endpoint
        if (!path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var clientIp = GetClientIp(context);
        var now = DateTime.UtcNow;

        // Clean up old entries periodically
        CleanupOldEntries(now);

        if (_attempts.TryGetValue(clientIp, out var entry))
        {
            // Check if currently locked out
            if (entry.LockedUntil.HasValue && now < entry.LockedUntil.Value)
            {
                var remainingSeconds = (int)(entry.LockedUntil.Value - now).TotalSeconds;
                context.Response.StatusCode = 429;
                context.Response.Headers.RetryAfter = remainingSeconds.ToString();
                await context.Response.WriteAsJsonAsync(new
                {
                    error = "Too many login attempts. Please try again later.",
                    retryAfterSeconds = remainingSeconds
                });
                return;
            }

            // Reset if window has passed
            if (now - entry.WindowStart > _windowDuration)
            {
                entry.AttemptCount = 0;
                entry.WindowStart = now;
                entry.LockedUntil = null;
            }
        }

        await _next(context);

        // After the request, check if it was a failed login (401 response)
        if (context.Response.StatusCode == 401 ||
            (context.Response.StatusCode == 200 && context.Items.ContainsKey("LoginFailed")))
        {
            RecordFailedAttempt(clientIp, now);
        }
        else if (context.Response.StatusCode == 200)
        {
            // Successful login - reset attempts
            _attempts.TryRemove(clientIp, out _);
        }
    }

    private void RecordFailedAttempt(string clientIp, DateTime now)
    {
        var entry = _attempts.GetOrAdd(clientIp, _ => new RateLimitEntry { WindowStart = now });

        entry.AttemptCount++;

        if (entry.AttemptCount >= _maxAttempts)
        {
            entry.LockedUntil = now.Add(_lockoutDuration);
        }
    }

    private static string GetClientIp(HttpContext context)
    {
        // Check for forwarded IP (when behind proxy/load balancer)
        var forwardedFor = context.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrEmpty(forwardedFor))
        {
            // Take the first IP in the chain (original client)
            var ip = forwardedFor.Split(',')[0].Trim();
            if (!string.IsNullOrEmpty(ip))
            {
                return ip;
            }
        }

        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }

    private void CleanupOldEntries(DateTime now)
    {
        var cutoff = now - _lockoutDuration - _windowDuration;
        var keysToRemove = _attempts
            .Where(kvp => kvp.Value.WindowStart < cutoff &&
                         (!kvp.Value.LockedUntil.HasValue || kvp.Value.LockedUntil.Value < now))
            .Select(kvp => kvp.Key)
            .ToList();

        foreach (var key in keysToRemove)
        {
            _attempts.TryRemove(key, out _);
        }
    }
}
