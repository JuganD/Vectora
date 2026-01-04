using System.Net;
using Azure.Messaging.ServiceBus;

namespace Vectora.Api.Middleware;

/// <summary>
/// Global exception handling middleware to prevent leaking stack traces and internal errors.
/// </summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    public ExceptionHandlingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionHandlingMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // Client disconnected - don't log as error
            context.Response.StatusCode = 499; // Client Closed Request
        }
        catch (ServiceBusException sbEx) when (sbEx.Reason == ServiceBusFailureReason.MessagingEntityNotFound)
        {
            // Entity not found - log as warning, not error
            _logger.LogWarning("Service Bus entity not found: {Message}", sbEx.Message);
            await HandleExceptionAsync(context, sbEx, HttpStatusCode.NotFound, "Queue, topic, or subscription not found");
        }
        catch (ServiceBusException sbEx)
        {
            // Other Service Bus errors
            _logger.LogError(sbEx, "Service Bus error for request {Method} {Path}",
                context.Request.Method, context.Request.Path);
            await HandleExceptionAsync(context, sbEx, HttpStatusCode.BadGateway, "Service Bus error");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception for request {Method} {Path}",
                context.Request.Method, context.Request.Path);

            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception, HttpStatusCode? overrideStatus = null, string? overrideMessage = null)
    {
        context.Response.ContentType = "application/json";

        var (statusCode, message) = (overrideStatus, overrideMessage) switch
        {
            (not null, not null) => (overrideStatus.Value, overrideMessage),
            _ => exception switch
            {
                ArgumentException => (HttpStatusCode.BadRequest, "Invalid request parameters"),
                UnauthorizedAccessException => (HttpStatusCode.Unauthorized, "Unauthorized"),
                KeyNotFoundException => (HttpStatusCode.NotFound, "Resource not found"),
                InvalidOperationException => (HttpStatusCode.BadRequest, "Invalid operation"),
                _ => (HttpStatusCode.InternalServerError, "An unexpected error occurred")
            }
        };

        context.Response.StatusCode = (int)statusCode;

        var response = new
        {
            error = message,
            // Only include details in development
            details = _environment.IsDevelopment() ? exception.Message : null
        };

        await context.Response.WriteAsJsonAsync(response);
    }
}
