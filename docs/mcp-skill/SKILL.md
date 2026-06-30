---
name: vectora-service-bus
description: Inspect and test Azure Service Bus through a Vectora MCP server. Use when the user wants to look at queues, topics, or subscriptions; read or browse messages; investigate dead-lettered (DLQ) messages and why they failed; check message counts; or send a test message to a queue or topic. Works against the Vectora MCP tools (list_connections, list_entities, peek_messages, peek_dead_letter_messages, send_message).
---

# Vectora — Azure Service Bus via MCP

Vectora exposes a set of MCP tools for browsing and testing Azure Service Bus. Use them whenever
the user asks about Service Bus queues/topics/subscriptions, the messages inside them, why
messages dead-lettered, or wants to publish a test message.

## Tools

- **`list_connections`** — Start here. Lists the Service Bus connections the user has exposed
  (`id`, `name`, `isEmulator`, `canSend`). Use the `id` for every other tool. Connection strings
  are never returned.
- **`list_entities(connectionId)`** — All queues (with `activeMessageCount` / `deadLetterMessageCount`)
  and topics with their subscriptions. Use this to discover entity names and spot where messages
  are piling up.
- **`peek_messages(connectionId, queueName | topicName+subscriptionName, max?, fromSequenceNumber?)`**
  — Reads **active** messages (non-destructive peek). Returns full message data: `body`,
  `contentType`, `subject`, `correlationId`, `sessionId`, `enqueuedTime`, `deliveryCount`,
  `applicationProperties`, etc. Default `max` 50, cap 1000. To page, call again with
  `fromSequenceNumber` set to the returned `nextSequenceNumber`.
- **`peek_dead_letter_messages(...)`** — Same shape as `peek_messages`, but the DLQ. Also includes
  `deadLetterReason`, `deadLetterErrorDescription`, and `deadLetterSource` — use these to explain
  *why* messages failed.
- **`send_message(connectionId, queueName | topicName, body, contentType?, subject?, messageId?,
  correlationId?, sessionId?, replyTo?, scheduledEnqueueTime?, applicationProperties?)`** — Publishes
  a message. Send to a **queue or topic** (not a subscription). Only works if the connection has
  sending enabled (`canSend: true`).

## Typical workflow

1. Call `list_connections` to find the connection `id`. If several match, ask the user which one.
2. Call `list_entities` to find the exact queue/topic/subscription name and see message counts.
3. To read a queue: `peek_messages` with `queueName`. To read a subscription: pass `topicName`
   **and** `subscriptionName`. For dead-letters, use `peek_dead_letter_messages`.
4. For deep queues, page with `fromSequenceNumber` = the previous `nextSequenceNumber`.
5. To send, confirm the target with the user first, then call `send_message`.

## If you can't reach the server

If the tools are unavailable, return an authorization error, or the connection is refused, the
Vectora MCP server is either disabled, not configured in this agent, or protected by an API key.
**Ask the user for:**

- the **Vectora MCP endpoint URL** (e.g. `http://localhost:8080/mcp`), and
- the **MCP API key**, if one is set (sent as `Authorization: Bearer <key>`).

Then tell them to add it to their MCP client configuration, for example:

```json
{
  "mcpServers": {
    "vectora": {
      "type": "http",
      "url": "<endpoint-url>",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

The key is found (or set) in Vectora under **Settings → MCP Server**.

## Important behavior

- **Reads are peek-only and non-destructive** — peeking never locks, consumes, or deletes
  messages. It's safe to browse production queues.
- **`send_message` writes a real message** to the queue/topic.
- A connection that isn't returned by `list_connections` has not been exposed to MCP — you can't
  read or write it. Tell the user to enable it in **Settings → MCP Server** if they need it.
