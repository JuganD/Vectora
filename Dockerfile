# Build stage for frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY src/Vectora.Client/package*.json ./
RUN npm install
COPY src/Vectora.Client/ ./
RUN npm run build

# Build stage for backend
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend-build
WORKDIR /app
COPY src/Vectora.Api/*.csproj ./
RUN dotnet restore Vectora.Api.csproj
COPY src/Vectora.Api/ ./
RUN dotnet publish Vectora.Api.csproj -c Release -o out

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create directories for data and emulator configs with proper permissions
RUN mkdir -p /data /emulator-configs && \
    chown -R app:app /data /emulator-configs

# Copy backend
COPY --from=backend-build /app/out ./

# Copy frontend build to wwwroot
COPY --from=frontend-build /app/frontend/dist ./wwwroot

# Set environment variables
ENV ASPNETCORE_URLS=http://+:8080
ENV DataPath=/data
ENV EmulatorConfigPath=/emulator-configs
ENV ASPNETCORE_ENVIRONMENT=Production

# Expose port
EXPOSE 8080

# Switch to non-root user
USER app

# Run the application
ENTRYPOINT ["dotnet", "Vectora.Api.dll"]