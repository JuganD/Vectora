using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Vectora.Api.Services;

public class JwtService : IJwtService
{
    private readonly byte[] _secretKey;
    private readonly TimeSpan _tokenLifetime = TimeSpan.FromHours(24);
    private const string Issuer = "Vectora";
    private const string Audience = "Vectora";

    public JwtService(IConfiguration configuration)
    {
        // Use VECTORA_PASSWORD as the seed for generating a secret key
        // If no password is set, generate a random key (which means tokens won't persist across restarts)
        var password = configuration["VECTORA_PASSWORD"] ?? Environment.GetEnvironmentVariable("VECTORA_PASSWORD");
        
        if (!string.IsNullOrEmpty(password))
        {
            // Derive a 256-bit key from the password using SHA256
            _secretKey = SHA256.HashData(Encoding.UTF8.GetBytes(password + "vectora-jwt-secret"));
        }
        else
        {
            // No password set - generate random key
            _secretKey = RandomNumberGenerator.GetBytes(32);
        }
    }

    public string GenerateToken()
    {
        var securityKey = new SymmetricSecurityKey(_secretKey);
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new Claim(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
        };

        var token = new JwtSecurityToken(
            issuer: Issuer,
            audience: Audience,
            claims: claims,
            expires: DateTime.UtcNow.Add(_tokenLifetime),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public bool ValidateToken(string token)
    {
        if (string.IsNullOrEmpty(token))
        {
            return false;
        }

        var tokenHandler = new JwtSecurityTokenHandler();
        var securityKey = new SymmetricSecurityKey(_secretKey);

        try
        {
            tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = securityKey,
                ValidateIssuer = true,
                ValidIssuer = Issuer,
                ValidateAudience = true,
                ValidAudience = Audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out _);

            return true;
        }
        catch
        {
            return false;
        }
    }
}

