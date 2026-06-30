# Vectora MCP Server

Vectora has a built-in **MCP (Model Context Protocol) server** so AI agents — Claude, or any
MCP-capable client — can browse and test your Azure Service Bus directly. It's meant for
**investigation and testing**: inspecting what's sitting in a queue, diagnosing dead-lettered
messages, and sending test messages.

It speaks MCP over **Streamable HTTP** at:

```
<your-vectora-host>/mcp        e.g. http://localhost:8080/mcp
```

## What an agent can do

| Tool | What it does |
|------|--------------|
| `list_connections` | Lists the connections you've exposed to MCP (id, name, emulator flag, whether sending is allowed). Connection strings are **never** exposed. |
| `list_entities` | All queues (with active/dead-letter counts) and topics with their subscriptions, for one connection. |
| `peek_messages` | Reads active messages from a queue or subscription — full body, system properties, and application properties. **Peek only**: non-destructive, nothing is locked or removed. |
| `peek_dead_letter_messages` | Same as above for the dead-letter queue (DLQ), including dead-letter reason, error description, and source. |
| `send_message` | Sends a message to a queue or topic (body + optional content type, subject, correlation id, session id, scheduled time, application properties). Requires sending to be enabled for that connection. |

Reads return up to `max` messages (default 50, hard cap 1000) and a `nextSequenceNumber` cursor
for paging through large queues.

## Enabling it

Everything is configured in **Settings → MCP Server** in the Vectora UI:

1. **Enable MCP server.** While off, `/mcp` responds with `404` and no agent can reach it.
2. **(Optional) API key.** When set, agents must send `Authorization: Bearer <key>`. Leave it
   empty for no authorization. The key is stored server-side and never returned by the API;
   changing or removing it takes effect immediately (no restart).
3. **Expose connections.** In the connections table, tick **Expose** for each connection an agent
   may read. Anything unexposed is invisible — your production namespace stays dark until you
   opt it in.
4. **Allow send (per connection).** To let agents publish to a connection, also tick **Allow
   send**. It's off by default and only applies to exposed connections.

## Connecting an agent

The agent needs the endpoint URL and, if you set one, the API key.

### Claude Code / Claude Desktop

Add an HTTP MCP server to your MCP config (e.g. a project `.mcp.json`):

```json
{
  "mcpServers": {
    "vectora": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_KEY"
      }
    }
  }
}
```

Omit the `headers` block if you didn't configure an API key.

### Drop-in skill

For the smoothest experience, install the ready-made skill in
[`docs/mcp-skill/SKILL.md`](mcp-skill/SKILL.md). It teaches the agent what data Vectora can fetch,
the right order to call the tools, and — if it can't reach the server — to ask you for the
endpoint URL and MCP key. Copy the folder into your agent's skills directory (for Claude Code:
`~/.claude/skills/vectora-service-bus/`).

## Safety model

- **Reads are peek-only** — browsing never locks, completes, or removes messages, so it's safe
  against live/production namespaces.
- **Nothing is exposed by default** — a connection must be explicitly exposed, and sending must
  be separately enabled per connection.
- **Auth is independent** of the Vectora UI password (`VECTORA_PASSWORD`); the MCP key is its own
  setting and the comparison is timing-safe.
