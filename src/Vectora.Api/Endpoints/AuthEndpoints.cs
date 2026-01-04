using System.Security.Cryptography;
using System.Text;
using Vectora.Api.Models;
using Vectora.Api.Services;

namespace Vectora.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapGet("/status", GetStatus)
            .WithName("GetAuthStatus");

        group.MapPost("/login", Login)
            .WithName("Login");

        group.MapPost("/validate", Validate)
            .WithName("ValidateToken");
    }

    private static IResult GetStatus(IConfiguration configuration)
    {
        var password = configuration["VECTORA_PASSWORD"] ?? Environment.GetEnvironmentVariable("VECTORA_PASSWORD");
        var authRequired = !string.IsNullOrEmpty(password);
        return Results.Ok(new AuthStatusDto { AuthRequired = authRequired });
    }

    private static IResult Login(LoginDto dto, IConfiguration configuration, HttpContext context, IJwtService jwtService)
    {
        var password = configuration["VECTORA_PASSWORD"] ?? Environment.GetEnvironmentVariable("VECTORA_PASSWORD");
        var authRequired = !string.IsNullOrEmpty(password);

        // If no password is set, allow any login
        if (!authRequired)
        {
            return Results.Ok(new AuthResultDto { Success = true, Token = "no-auth-required" });
        }

        // Validate password using timing-safe comparison
        var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(password!));
        var inputHash = SHA256.HashData(Encoding.UTF8.GetBytes(dto.Password ?? ""));

        if (CryptographicOperations.FixedTimeEquals(inputHash, expectedHash))
        {
            // Generate and return JWT token
            var token = jwtService.GenerateToken();
            return Results.Ok(new AuthResultDto { Success = true, Token = token });
        }

        // Mark as failed login for rate limiter
        context.Items["LoginFailed"] = true;
        return Results.Json(new AuthResultDto { Success = false, Error = "Invalid password" }, statusCode: 401);
    }

    private static IResult Validate(HttpContext context, IConfiguration configuration, IJwtService jwtService)
    {
        var password = configuration["VECTORA_PASSWORD"] ?? Environment.GetEnvironmentVariable("VECTORA_PASSWORD");
        var authRequired = !string.IsNullOrEmpty(password);

        // If no password is set, always valid
        if (!authRequired)
        {
            return Results.Ok(new AuthResultDto { Success = true, Token = "no-auth-required" });
        }

        // Get token from Authorization header
        if (!context.Request.Headers.TryGetValue("Authorization", out var authHeader) ||
            string.IsNullOrEmpty(authHeader))
        {
            return Results.Json(new AuthResultDto { Success = false, Error = "No token provided" }, statusCode: 401);
        }

        // Extract Bearer token
        var headerValue = authHeader.ToString();
        if (!headerValue.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Json(new AuthResultDto { Success = false, Error = "Invalid authorization header format" }, statusCode: 401);
        }

        var token = headerValue.Substring(7);

        // Validate JWT
        if (jwtService.ValidateToken(token))
        {
            return Results.Ok(new AuthResultDto { Success = true, Token = token });
        }

        return Results.Json(new AuthResultDto { Success = false, Error = "Invalid or expired token" }, statusCode: 401);
    }
}

