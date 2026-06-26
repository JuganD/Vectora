# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vectora is a self-hosted Azure Service Bus explorer (lightweight Service Bus Explorer alternative). Two projects in one repo, built and shipped together as a single container:

- `src/Vectora.Api` — .NET 10 minimal-API backend (also serves the built SPA from `wwwroot`).
- `src/Vectora.Client` — React 18 + TypeScript + Vite + Tailwind frontend, Monaco for message editing.

## Common commands

Backend (from `src/Vectora.Api`):
- `dotnet run` — runs on `http://localhost:5244` (see `Properties/launchSettings.json`). `ASPNETCORE_ENVIRONMENT=Development`.
- `dotnet ef migrations add <Name>` — add an EF Core migration. Migrations live in `src/Vectora.Api/Migrations/` and are auto-applied at startup (`db.Database.Migrate()` in `Program.cs`), so do not call `database update` manually unless you're working outside the app.
- `dotnet build` from the solution: `src/Vectora.Api/Vectora.sln`.

Frontend (from `src/Vectora.Client`):
- `npm install`
- `npm run dev` — Vite dev server on port 5173. **Note:** `vite.config.ts` proxies `/api` to `http://localhost:5000`, but the backend's default dev port is `5244`. When running the two separately, either start the backend on 5000 (`ASPNETCORE_URLS=http://localhost:5000 dotnet run`) or copy `.env.example` to `.env.local` and set `VITE_API_URL=http://localhost:5244/api`.
- `npm run build` — type-checks (`tsc -b`) then builds to `dist/`. The Dockerfile copies this output into `wwwroot`.

Docker:
- `docker compose up -d --build` — builds and runs the combined image on `http://localhost:8080`. Data volume is `vectora-data` mounted at `/data` (SQLite lives there).

There is no test project in this repo.

## Architecture

### Request pipeline (`Program.cs`)

Middleware order is significant and explicitly commented in `Program.cs`:

1. `ExceptionHandlingMiddleware` — translates exceptions to JSON error responses. Suppresses stack traces in non-Development environments; maps `ServiceBusException.MessagingEntityNotFound` → 404, other `ServiceBusException` → 502, `OperationCanceledException` (client disconnect) → 499.
2. `SecurityHeadersMiddleware`
3. `LoginRateLimitingMiddleware` — only acts on `/api/auth/login`; 5 attempts / 5 min window / 15 min lockout per client IP (`X-Forwarded-For` aware). Tunable via `RateLimit:*` config keys.
4. Static files + `UseDefaultFiles` — serves the built SPA from `wwwroot`.
5. `AuthMiddleware` — see below.
6. Endpoint mapping (minimal APIs grouped by feature in `Endpoints/*.cs`).
7. `MapFallbackToFile("index.html")` — SPA routing fallback.

Kestrel max request body is set to 10 MB.

### Authentication

Auth is **optional and password-only**, gated by the `VECTORA_PASSWORD` environment variable.

- If `VECTORA_PASSWORD` is unset, all requests are allowed; the frontend stores the sentinel token `"no-auth-required"` and skips the login screen.
- If set, `/api/auth/login` accepts the password (timing-safe SHA256 compare) and returns a JWT signed with `SHA256(password + "vectora-jwt-secret")`. Tokens live 24h, issuer/audience both `"Vectora"`.
- `AuthMiddleware` allow-lists `/api/auth/login|validate|status` and any non-`/api` path (static files); everything else requires a valid `Authorization: Bearer <jwt>`. Failed logins set `context.Items["LoginFailed"]` which the rate limiter reads after the pipeline unwinds.
- Frontend stores the JWT in `localStorage` under `vectora_token`; a 401 from any API call clears it and reloads the page.

Because the JWT signing key is derived from `VECTORA_PASSWORD`, **rotating the password invalidates every existing token**. If no password is set, a random key is generated per process and tokens don't survive restarts.

### Persistence

SQLite via EF Core (`VectoraDbContext`). Database file is `{DataPath}/vectora.db`, where `DataPath` defaults to `./data` locally and is set to `/data` in the container image. On startup the app:

1. Creates the data directory.
2. Applies pending migrations.
3. Enables WAL journal mode and `busy_timeout = 5000` for concurrent-write resilience.

Entities (each with a unique index on name/key):
- `ServiceBusConnection` — saved Service Bus connections; `IsEmulator` + `EmulatorConfigId` link to a stored emulator config.
- `EmulatorConfigFile` — raw JSON content of an Azure Service Bus Emulator config (the file you'd otherwise pass to the emulator at startup).
- `Setting` — key/value app settings (e.g. `BatchOperationTimeoutSeconds`, clamped 10–600).
- `MessageTemplate` — saved message bodies for resend.

### Service Bus client caching

`ServiceBusClientCache` (registered as a singleton, `Helpers/ServiceBusClientCache.cs`) holds one `ServiceBusClient` and one `ServiceBusAdministrationClient` per `connectionId` plus the connection string that was used to build them. When a connection is updated or deleted (or its connection string changes between gets), `ConnectionRepository` calls `InvalidateConnection(id)` and the cached clients are disposed in the background. Anything that talks to Service Bus must go through this cache rather than constructing clients directly.

### Emulator vs real Service Bus

`ServiceBusService` picks an entity-management path per call via `GetManagementClientAsync`:

- **Real Service Bus**: uses `ServiceBusAdministrationClient` for entity CRUD and runtime info.
- **Emulator with a reachable management API**: newer Azure Service Bus Emulator builds (with SDK ≥ 7.20) expose the admin API over a separate HTTP port (5300 by default, configurable via the `EmulatorAdminPort` setting / `EMULATOR_HTTP_PORT` on the emulator). When a TCP probe to that port succeeds, the emulator is driven through the same `ServiceBusAdministrationClient` code path as real Service Bus — full CRUD and real message counts. The admin client is built from a connection string whose `Endpoint` is rewritten to the admin port (`EmulatorAdmin.BuildAdminConnectionString`); the data-plane `ServiceBusClient` keeps the original string. Probe results are cached on `ServiceBusClientCache` and re-checked on each explicit refresh (`refreshCache=true`).
- **Emulator with no reachable management API (fallback)**: entity CRUD reads/mutates the JSON config stored in `EmulatorConfigFile` via `EmulatorConfigService`, and runtime message counts are reported as 0; messaging operations (send/peek/receive/DLQ) always go through the regular `ServiceBusClient` regardless.

`GetEntitiesAsync` returns a `SupportsManagement` flag (true for real Service Bus, and for emulators when admin is reachable). The frontend threads it through as `canManage` to gate the create/edit/delete UI and runtime-count refreshes. When adding new entity-management features, route admin access through `GetManagementClientAsync` and keep the `EmulatorConfigService` fallback for the no-admin case.

### Endpoint layout

Minimal APIs grouped in `Endpoints/`:
- `AuthEndpoints` — `/api/auth/{status,login,validate}`
- `ConnectionEndpoints` — `/api/connections`
- `EmulatorConfigEndpoints` — `/api/emulator-configs`
- `ServiceBusEndpoints` — `/api/connections/{connectionId:int}/servicebus/...` for entity (queue/topic/subscription) management
- `ServiceBusMessageEndpoints` — same prefix, for peek/receive/send and DLQ return/consume (both single and batch by sequence number)
- `MessageTemplateEndpoints` — `/api/message-templates`
- `SettingsEndpoints` — `/api/settings`

DTOs live in `Models/Dtos/`. `ValidationHelper` enforces entity-name and message-body/`maxMessages` rules at the endpoint boundary.

### Frontend structure

Single-page app under `src/Vectora.Client/src/`:
- `api/client.ts` — every API call goes through one `fetchApi` helper that attaches the bearer token and reloads the page on 401. Base URL is `import.meta.env.VITE_API_URL || '/api'`.
- `App.tsx` — boots auth state, mounts `LoginPage` or `MainLayout`.
- `components/MainLayout.tsx` — top-level shell; persists the last selected connection in `localStorage` under `vectora_last_connection`.
- `components/EntityBrowser.tsx`, `MessagePanel.tsx`, `MessageViewer.tsx`, `SendMessageDialog.tsx`, `ConnectionManager.tsx`, `EditEntityDialog.tsx`, `SettingsDialog.tsx` — feature panels.
- `types/index.ts` — shared TS types mirroring the API DTOs (camelCase).

Tailwind is configured via `tailwind.config.js` + `postcss.config.js`; Monaco is loaded via `@monaco-editor/react`.

### Configuration & environment

| Variable | Used for |
|---|---|
| `VECTORA_PASSWORD` | Optional login password; also seeds the JWT signing key |
| `DataPath` | Directory for `vectora.db` (default `./data`, `/data` in container) |
| `EmulatorConfigPath` | Set in the container image but the current code reads emulator configs from the DB, not the filesystem |
| `EmulatorAdminPort` | Port the Service Bus emulator serves the management API on (default `5300`). Used to build the emulator admin connection string and to probe admin availability |
| `ASPNETCORE_URLS` | Standard ASP.NET hosting binding |
| `VITE_API_URL` | Frontend base URL for API calls (set in `.env.local` for split dev) |

CI (`.github/workflows/docker-publish.yml`) builds multi-arch images on every push/PR to `main` and pushes to Docker Hub (`jugand/vectora`) on GitHub Releases only.
