# VoicePrompter Protocol

Protocol version: **1**

VoicePrompter Protocol (VPP) is the application-level JSON protocol used between VoicePrompter, VoicePrompterModule and VoicePrompterBridge.

VoicePrompterBridge is primarily a transport layer. It authenticates connections, maintains transport queues, validates that each WebSocket message is syntactically valid JSON, routes messages by mailbox, and handles only explicitly defined messages addressed to `server`.

## Common envelope

Every VPP message MUST contain `protocolVersion`, unique `id`, `type`, `from`, `recipient`, `source`, and `timestamp`.

```json
{
  "protocolVersion": 1,
  "id": "019c7f8e-7c5d-7a91-bfa3-2c6b78a6a421",
  "type": "call",
  "from": "bc",
  "recipient": "vp",
  "source": {
    "app": "VoicePrompterModule",
    "version": "0.8.0",
    "companionVersion": "dev"
  },
  "timestamp": "2026-08-12T10:46:00.000+02:00"
}
```

`from` identifies the logical sending mailbox. `recipient` identifies the destination. Protocol version 1 defines exactly three routing names:

- `vp` — VoicePrompter mailbox;
- `bc` — VoicePrompterModule / Bitfocus Companion mailbox;
- `server` — VoicePrompterBridge itself.

VPBridge maintains exactly two transport mailboxes in VPP v1: `vp` and `bc`. `server` is not a mailbox. A connection to `/vp` owns mailbox `vp`; a connection to `/bc` owns mailbox `bc`.

`from` MUST match the mailbox through which the message was received. VPBridge MUST reject a message whose `from` does not match its connection mailbox. Messages addressed to `vp` or `bc` MUST be routed only to that mailbox. Messages addressed to `server` MUST be consumed by VPBridge and MUST NOT be forwarded.

`source` contains diagnostic application/version metadata and is distinct from routing identity.

`id` uniquely identifies one message. IDs MUST NOT be reused. UUIDv7 is preferred; another sufficiently unique UUID is acceptable.

## Correlation and acknowledgements

A message related to a previous message MUST contain `correlationId` equal to the original message's `id`. Multiple requests may be in flight simultaneously and correlation MUST therefore be based on IDs, never on ordering.

Any VPP message with `expectsResponse: true` creates a request and MUST terminate with exactly one correlated `response` or `error`. Zero or more correlated `progress` messages MAY precede the terminal message.

A `response` means the message arrived and requested processing completed successfully. Its `result` MAY contain only a success acknowledgement or additional requested result data.

An `error` means the message arrived but processing failed, was rejected, was unsupported, or could not be completed.

Receipt of a valid message from the opposite mailbox, including `progress`, `response` or `error`, is proof of life and refreshes the peer-activity timer.

## call

`call` requests execution of a public protocol method.

`args` MUST be a JSON object. Use `{}` when there are no arguments. Each method has a deterministic argument schema. A receiver MUST reject unknown methods, unknown arguments, missing required arguments, or arguments of the wrong type with a correlated protocol `error` when `expectsResponse` is true.

Initial VoicePrompter navigation methods:

- `goStart` — `args: {}`;
- `markerBack` — `args: { "offset": <integer> }`;
- `goBack` — `args: { "offset": <integer> }`;
- `goCurrent` — `args: { "offset": <integer> }`;
- `goNext` — `args: { "offset": <integer> }`;
- `markerNext` — `args: { "offset": <integer> }`;
- `goFinish` — `args: {}`.

Offset semantics: `goNext` positive moves forward and negative backward; `goBack` is the reverse; `markerNext` and `markerBack` follow the analogous marker direction. `goCurrent` ignores sign: 0 does nothing, 1 goes to the current paragraph start, 2 to the previous paragraph, etc. `goStart` and `goFinish` do not use an offset.

Navigation calls SHOULD use `expectsResponse: true`. VoicePrompter MUST return a terminal `response` after successful execution or `error` after failure.

## event

Events report unsolicited events. An event MAY set `expectsResponse: true` when the sender needs explicit confirmation that the event was accepted and processed.

Event schemas are deterministic per event name.

### marker event

VoicePrompter emits a `marker` event when reading crosses a skipped marker in square brackets.

`command` is a non-empty string containing the marker command/name. `args` is a JSON array containing the marker's ordered arguments. Numbers are JSON numbers; quoted values are strings. VoicePrompter parses marker syntax but does not interpret command meaning.

Example `[VLC PLAY 2, "Intro.mp4", 5]` becomes:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "from": "vp",
  "recipient": "bc",
  "event": "marker",
  "command": "VLC PLAY",
  "args": [2, "Intro.mp4", 5],
  "expectsResponse": true,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

Additional marker arguments MUST be comma-separated. String arguments MUST be double-quoted. Invalid marker syntax MUST NOT be emitted and SHOULD be logged diagnostically.

When `expectsResponse` is true, VPM returns `response` after successfully parsing/publishing the marker event or `error` if it cannot process it.

## progress

`progress` reports that work for a previous request is still in progress. `correlationId` is required. Progress does not terminate the request.

## response

`response` is the terminal successful response to a previous message that requested a response. `correlationId` is required and MUST equal the original message's `id`.

A simple acknowledgement MAY use:

```json
"result": { "success": true }
```

## error

`error` is the terminal unsuccessful response. For an error concerning a specific previous message, `correlationId` is required and MUST equal that message's `id`.

`error.code` is stable and machine-readable. `error.message` is human-readable. `error.details` is optional structured diagnostic data.

Recommended common error codes include `INVALID_MESSAGE`, `INVALID_ROUTING`, `UNKNOWN_METHOD`, `UNKNOWN_ARGUMENT`, `INVALID_ARGUMENT`, `COMMAND_FAILED`, `UNSUPPORTED_PROTOCOL`, and `TIMEOUT`.

## Server ping

`ping` is a system `call` handled by VPBridge. It verifies the bridge connection and obtains current mailbox state and heartbeat policy.

A ping MUST use:

- `from`: the caller's mailbox (`vp` or `bc`);
- `recipient: "server"`;
- `method: "ping"`;
- `args: {}`;
- `expectsResponse: true`.

Example:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "from": "vp",
  "recipient": "server",
  "method": "ping",
  "args": {},
  "expectsResponse": true,
  "source": { "app": "VoicePrompter", "version": "..." },
  "timestamp": "..."
}
```

VPBridge MUST consume the ping locally and MUST NOT forward it.

Response:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "correlationId": "<ping-id>",
  "type": "response",
  "from": "server",
  "recipient": "vp",
  "result": {
    "mailboxes": {
      "vp": { "connected": true },
      "bc": { "connected": true }
    },
    "heartbeat": {
      "intervalMs": 30000
    }
  },
  "source": { "app": "VoicePrompterBridge", "version": "..." },
  "timestamp": "..."
}
```

The same response shape is used for a ping originating from `bc`; only `recipient` changes to `bc`.

The `mailboxes` object is keyed by mailbox name. `connected` reports whether the mailbox currently has an active WebSocket owner. VPP v1 defines exactly the `vp` and `bc` entries, but clients SHOULD read status by mailbox name rather than depend on dedicated fields such as `vpConnected` or `bcConnected`.

An unsupported message addressed to `server` SHOULD receive a correlated `error` and MUST NOT be forwarded.

## Heartbeat / idle health check

VPBridge is authoritative for the heartbeat interval. The default is **30000 ms (30 seconds)**. The interval is configured once on VPBridge and distributed to both clients in the server ping response as `result.heartbeat.intervalMs`.

VP and VPM MUST obtain the heartbeat interval after establishing/re-establishing their WebSocket connection. The value is session state; clients MUST obtain it again after reconnect rather than relying permanently on a cached value.

Normal valid VPP traffic from the opposite mailbox is proof of life. If peer traffic has occurred within the heartbeat interval, no heartbeat ping is necessary.

After a full heartbeat interval without valid peer traffic, the client sends a `ping` to `server` to obtain current mailbox state.

Clients use a fixed implementation grace period of **5000 ms (5 seconds)** after sending the heartbeat ping. This grace period is hard-coded in VP and VPM, is not configured by VPBridge, and exists to absorb scheduler, processing and network jitter so connection status does not oscillate at the boundary.

With the default interval, a client therefore allows up to **35000 ms (35 seconds)** from the last confirmed peer activity before treating the expected health confirmation as failed.

A valid ping response with the opposite mailbox `connected: false` means the bridge connection is alive but the peer is unavailable. Failure to receive the ping response within the 5-second grace period means the VPBridge connection itself is unhealthy and the client SHOULD reconnect.

## Connection-state interpretation

Clients SHOULD expose these three states:

- **connected** — WebSocket to VPBridge is healthy and the opposite mailbox is connected;
- **bridge-only** — WebSocket to VPBridge is healthy but the opposite mailbox is not connected;
- **disconnected** — VPBridge WebSocket is not healthy or server ping timed out.

## VPBridge transport rule

VPBridge SHALL:

1. authenticate the WebSocket connection according to its transport configuration;
2. accept only complete syntactically valid JSON messages;
3. verify the routing envelope fields needed for transport (`from`, `recipient`);
4. route messages addressed to `vp` or `bc` unchanged to the named mailbox according to FIFO/buffer rules;
5. consume messages addressed to `server` locally and never forward them;
6. interpret only system methods explicitly defined by VPP for `recipient: "server"`;
7. maintain current connected/disconnected state of the `vp` and `bc` mailboxes;
8. reject invalid JSON and log the drop diagnostically.

Except for routing and explicitly defined `server` methods, VPBridge SHALL NOT interpret application-level VPP fields such as application methods, marker commands, application arguments, results, progress data, or application errors.

## Compatibility

A receiver unable to support `protocolVersion` SHOULD return `UNSUPPORTED_PROTOCOL` when a correlated response is possible.

Receivers MAY ignore unknown optional metadata fields, but MUST NOT silently accept unknown deterministic method/event arguments.

Application and Companion versions are diagnostic metadata and do not replace `protocolVersion`.
