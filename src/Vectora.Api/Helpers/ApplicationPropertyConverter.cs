using System.Globalization;
using System.Text.Json;

namespace Vectora.Api.Helpers;

// Converts application-property values between the JSON wire format and the CLR types the
// Service Bus SDK puts on the AMQP message. Service Bus application properties are typed
// (a consumer casting a property to Int32 fails if it arrives as a string), so send requests
// accept either a bare JSON value (string/number/bool — type inferred) or an explicit
// { "value": "...", "type": "int" } object, and peek responses report each property's
// original CLR type so the UI can round-trip it when templating a message.
public static class ApplicationPropertyConverter
{
    public static readonly string[] SupportedTypes =
        ["string", "bool", "int", "long", "double", "decimal", "guid", "datetime", "timespan"];

    public static (bool IsValid, string? Error) TryConvertAll(
        Dictionary<string, JsonElement>? properties,
        out Dictionary<string, object>? converted)
    {
        converted = null;
        if (properties == null || properties.Count == 0)
        {
            return (true, null);
        }
        var result = new Dictionary<string, object>(properties.Count);
        foreach (var (key, element) in properties)
        {
            try
            {
                result[key] = ConvertValue(element);
            }
            catch (ArgumentException ex)
            {
                return (false, $"Application property '{key}': {ex.Message}");
            }
        }
        converted = result;
        return (true, null);
    }

    private static object ConvertValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString() ?? string.Empty,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
        JsonValueKind.Object => ConvertTypedValue(element),
        _ => throw new ArgumentException("unsupported JSON value; expected a string, number, boolean, or a { value, type } object")
    };

    private static object ConvertTypedValue(JsonElement element)
    {
        var value = element.TryGetProperty("value", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        if (value == null)
        {
            throw new ArgumentException("expected an object with a string 'value' field");
        }
        var type = element.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
        return Parse(value, type ?? "string");
    }

    public static object Parse(string value, string type)
    {
        var v = value.Trim();
        return type.ToLowerInvariant() switch
        {
            "string" => value,
            "bool" => bool.TryParse(v, out var b) ? b : throw Invalid(value, type),
            "int" => int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) ? i : throw Invalid(value, type),
            "long" => long.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) ? l : throw Invalid(value, type),
            "double" => double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : throw Invalid(value, type),
            "decimal" => decimal.TryParse(v, NumberStyles.Number, CultureInfo.InvariantCulture, out var m) ? m : throw Invalid(value, type),
            "guid" => Guid.TryParse(v, out var g) ? g : throw Invalid(value, type),
            "datetime" => DateTimeOffset.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) ? dt : throw Invalid(value, type),
            "timespan" => TimeSpan.TryParse(v, CultureInfo.InvariantCulture, out var ts) ? ts : throw Invalid(value, type),
            _ => throw new ArgumentException($"unknown type '{type}' (expected one of: {string.Join(", ", SupportedTypes)})")
        };
    }

    private static ArgumentException Invalid(string value, string type) =>
        new($"'{value}' is not a valid {type} value");

    // Type name reported for peeked messages so the UI can preselect the same type on resend.
    public static string TypeNameOf(object? value) => value switch
    {
        null or string => "string",
        bool => "bool",
        byte or sbyte or short or ushort or int => "int",
        uint or long or ulong => "long",
        float or double => "double",
        decimal => "decimal",
        Guid => "guid",
        DateTime or DateTimeOffset => "datetime",
        TimeSpan => "timespan",
        _ => "string"
    };
}
