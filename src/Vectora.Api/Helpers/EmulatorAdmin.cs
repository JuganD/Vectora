using System.Net.Sockets;

namespace Vectora.Api.Helpers;

/// <summary>
/// Helpers for talking to the Azure Service Bus emulator's management API.
///
/// The emulator exposes the AMQP data plane on the endpoint in the connection string
/// (port 5672 by default) but serves <see cref="Azure.Messaging.ServiceBus.Administration.ServiceBusAdministrationClient"/>
/// operations over a separate HTTP endpoint (port 5300 by default). Pointing the admin
/// client at the emulator therefore means rewriting the connection string's endpoint to
/// the management port. Support for this landed in Azure.Messaging.ServiceBus 7.20.0+.
/// </summary>
public static class EmulatorAdmin
{
    public const int DefaultAdminPort = 5300;

    /// <summary>
    /// Returns a copy of <paramref name="connectionString"/> whose <c>Endpoint</c> host is
    /// pointed at <paramref name="adminPort"/>, leaving every other segment untouched.
    /// Falls back to the original string if no usable <c>Endpoint</c> segment is found.
    /// </summary>
    public static string BuildAdminConnectionString(string connectionString, int adminPort = DefaultAdminPort)
    {
        var segments = connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < segments.Length; i++)
        {
            var segment = segments[i];
            var eq = segment.IndexOf('=');
            if (eq < 0) continue;

            var key = segment[..eq].Trim();
            if (!key.Equals("Endpoint", StringComparison.OrdinalIgnoreCase)) continue;

            var endpoint = segment[(eq + 1)..].Trim();
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)) return connectionString;

            segments[i] = $"{key}={uri.Scheme}://{uri.Host}:{adminPort}";
            return string.Join(';', segments);
        }
        return connectionString;
    }

    /// <summary>
    /// Extracts the host and admin port the management client would connect to, so callers
    /// can cheaply probe whether the emulator's admin endpoint is actually listening.
    /// </summary>
    public static (string Host, int Port)? GetAdminEndpoint(string connectionString, int adminPort = DefaultAdminPort)
    {
        foreach (var segment in connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = segment.IndexOf('=');
            if (eq < 0) continue;

            var key = segment[..eq].Trim();
            if (!key.Equals("Endpoint", StringComparison.OrdinalIgnoreCase)) continue;

            var endpoint = segment[(eq + 1)..].Trim();
            if (Uri.TryCreate(endpoint, UriKind.Absolute, out var uri))
            {
                return (uri.Host, adminPort);
            }
            return null;
        }
        return null;
    }

    /// <summary>
    /// Best-effort TCP connect to decide whether the emulator's management port is reachable.
    /// Returns false (never throws) on refusal, timeout, or any other connectivity error so
    /// the caller can fall back to the config-file behavior.
    /// </summary>
    public static async Task<bool> IsPortReachableAsync(string host, int port, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(timeout);
            using var client = new TcpClient();
            await client.ConnectAsync(host, port, cts.Token);
            return client.Connected;
        }
        catch
        {
            return false;
        }
    }
}
