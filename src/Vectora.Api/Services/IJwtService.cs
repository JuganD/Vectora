namespace Vectora.Api.Services;

public interface IJwtService
{
    string GenerateToken();
    bool ValidateToken(string token);
}

