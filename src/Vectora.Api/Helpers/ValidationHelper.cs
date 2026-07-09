using System.Text.RegularExpressions;

namespace Vectora.Api.Helpers;

/// <summary>
/// Provides validation methods for input data.
/// </summary>
public static partial class ValidationHelper
{
    // Max lengths for various fields
    public const int MaxNameLength = 256;
    public const int MaxConnectionStringLength = 2048;
    public const int MaxMessageBodyLength = 256 * 1024; // 256 KB
    public const int MaxEntityNameLength = 260; // Azure Service Bus limit
    public const int MaxConfigContentLength = 1024 * 1024; // 1 MB

    /// <summary>
    /// Validates a connection name.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateConnectionName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return (false, "Connection name is required");
        }

        if (name.Length > MaxNameLength)
        {
            return (false, $"Connection name must be at most {MaxNameLength} characters");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates a connection string format.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateConnectionString(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return (false, "Connection string is required");
        }

        if (connectionString.Length > MaxConnectionStringLength)
        {
            return (false, $"Connection string must be at most {MaxConnectionStringLength} characters");
        }

        // Basic validation - should contain Endpoint
        if (!connectionString.Contains("Endpoint=", StringComparison.OrdinalIgnoreCase))
        {
            return (false, "Invalid connection string format - must contain Endpoint");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates a Service Bus entity name (queue, topic, subscription).
    /// </summary>
    public static (bool IsValid, string? Error) ValidateEntityName(string? name, string entityType)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return (false, $"{entityType} name is required");
        }

        if (name.Length > MaxEntityNameLength)
        {
            return (false, $"{entityType} name must be at most {MaxEntityNameLength} characters");
        }

        // Azure Service Bus naming rules
        if (!EntityNameRegex().IsMatch(name))
        {
            return (false, $"{entityType} name contains invalid characters. Use only letters, numbers, periods, hyphens, and underscores");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates a message body.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateMessageBody(string? body)
    {
        if (string.IsNullOrEmpty(body))
        {
            return (false, "Message body is required");
        }

        if (body.Length > MaxMessageBodyLength)
        {
            return (false, $"Message body must be at most {MaxMessageBodyLength / 1024} KB");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates emulator config content.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateConfigContent(string? content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            return (false, "Config content is required");
        }

        if (content.Length > MaxConfigContentLength)
        {
            return (false, $"Config content must be at most {MaxConfigContentLength / 1024} KB");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates batch operation timeout.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateBatchTimeout(int? timeout)
    {
        if (!timeout.HasValue)
        {
            return (true, null); // Optional
        }

        if (timeout.Value < 10 || timeout.Value > 600)
        {
            return (false, "Batch operation timeout must be between 10 and 600 seconds");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates max messages parameter.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateMaxMessages(int maxMessages, int maxLimit = 1000)
    {
        if (maxMessages < 1 || maxMessages > maxLimit)
        {
            return (false, $"Max messages must be between 1 and {maxLimit}");
        }

        return (true, null);
    }

    /// <summary>
    /// Validates the "send multiple times" count.
    /// </summary>
    public static (bool IsValid, string? Error) ValidateSendCount(int count, int maxLimit = 100000)
    {
        if (count < 1 || count > maxLimit)
        {
            return (false, $"Count must be between 1 and {maxLimit}");
        }

        return (true, null);
    }

    [GeneratedRegex(@"^[a-zA-Z0-9._-]+$")]
    private static partial Regex EntityNameRegex();
}
