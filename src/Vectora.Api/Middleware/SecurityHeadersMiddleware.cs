namespace Vectora.Api.Middleware;

/// <summary>
/// Adds security headers to all responses.
/// </summary>
public class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;
    private readonly bool _isDevelopment;

    public SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment env)
    {
        _next = next;
        _isDevelopment = env.IsDevelopment();
    }

    public async Task InvokeAsync(HttpContext context)
    {
        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.XFrameOptions = "DENY";
        context.Response.Headers.XXSSProtection = "1; mode=block";
        context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        context.Response.Headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()";

        // Monaco Editor requires CDN access, unsafe-eval, and data: fonts for codicon
        context.Response.Headers.ContentSecurityPolicy =
            "default-src 'self'; " +
            "script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'; " +
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
            "img-src 'self' data:; " +
            "font-src 'self' https://cdn.jsdelivr.net data:; " +
            "connect-src 'self'; " +
            "worker-src 'self' blob:; " +
            "frame-ancestors 'none'; " +
            "form-action 'self'; " +
            "base-uri 'self';";

        // CORS for development
        if (_isDevelopment)
        {
            context.Response.Headers.AccessControlAllowOrigin = "*";
            context.Response.Headers.AccessControlAllowMethods = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
            context.Response.Headers.AccessControlAllowHeaders = "Content-Type, Authorization, X-Requested-With";

            if (context.Request.Method == "OPTIONS")
            {
                context.Response.StatusCode = 204;
                return;
            }
        }

        await _next(context);
    }
}
