# VoicePrompter Protocol

Protocol version: **1**

VoicePrompter Protocol (VPP) is the application-level JSON protocol used between VoicePrompter and integrations such as VoicePrompterModule.

VoicePrompterBridge is only a transport layer. It authenticates connections, maintains transport queues, validates that each WebSocket message is syntactically valid JSON, and forwards the JSON unchanged. VPBridge MUST NOT interpret fields defined by this protocol.

## Common envelope

Every protocol message SHOULD contain:

```json
{
  "protocolVersion": 1,
  "id": "019c7f8e-7c5d-7a91-bfa3-2c6b78a6a421",
  "type": "call",
  "source": {
    "app": "VoicePrompterModule",
    "version": "0.5.0",
    "companionVersion": "dev"
  },
  "timestamp": "2026-08-11T20:54:31.152+02:00"
}
```

`id` uniquely identifies the individual message. UUIDv7 is preferred. IDs MUST NOT be reused after restart.

`timestamp` is an RFC 3339 / ISO 8601 timestamp including milliseconds and timezone offset.

`protocolVersion` identifies the application protocol independently of application versions.

`source` is diagnostic metadata. `app` identifies the sender, `version` is the sender version, and host-version fields such as `companionVersion` may be added when relevant.

## Correlation

A message that relates to a previous message MUST contain `correlationId` equal to the original message's `id`.

A single call may therefore produce zero or more progress messages followed by one terminal response or error. Multiple calls may be in flight simultaneously.

## Message types

### call

Requests execution of a public protocol method.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "call",
  "method": "goCurrent",
  "args": {
    "offset": 1
  },
  "expectsResponse": false,
  "source": {
    "app": "VoicePrompterModule",
    "version": "0.5.0"
  },
  "timestamp": "2026-08-11T20:54:31.152+02:00"
}
```

`method` is the stable public protocol method name.

For `call` messages, `args` MUST be a JSON object. Use `{}` when a method has no arguments.

`expectsResponse` indicates whether the caller expects a terminal `response` or `error`.

Initial navigation methods:

- `goStart`
- `markerBack`
- `goBack`
- `goCurrent`
- `goNext`
- `markerNext`
- `goFinish`

Navigation offset semantics currently implemented by VoicePrompter:

- omitted `offset` is treated as `0`;
- `goNext`: positive moves forward, negative moves backward, `0` does nothing;
- `goBack`: positive moves backward, negative moves forward, `0` does nothing;
- `markerNext`: positive moves to following markers, negative to previous markers, `0` does nothing;
- `markerBack`: positive moves to previous markers, negative to following markers, `0` does nothing;
- `goCurrent`: sign is ignored; `0` does nothing, `1` moves to the start of the current paragraph, `2` to the previous paragraph, `3` to the paragraph before that, etc.;
- `goStart` and `goFinish` currently ignore `offset` and perform only the native start/finish action.

### event

Reports an unsolicited event.

Event-specific arguments use the field `args`. Unlike `call.args`, an event MAY define the shape of `args` specifically for that event.

#### marker event

VoicePrompter emits a `marker` event when reading crosses a skipped marker enclosed in square brackets.

Example marker in the script:

```text
[VLC PLAY 2]
```

VPP message:

```json
{
  "protocolVersion": 1,
  "id": "...",
  "type": "event",
  "event": "marker",
  "command": "VLC PLAY",
  "args": [2],
  "source": {
    "app": "VoicePrompter",
    "version": "devel"
  },
  "timestamp": "2026-08-11T20:54:34.521+02:00"
}
```

For `marker` events:

- `command` is the marker command/name;
- `args` is always a JSON array;
- numbers are emitted as JSON numbers;
- quoted values are emitted as JSON strings;
- the marker brackets are not transmitted as part of `command` or `args`;
- VoicePrompter parses marker syntax but does not interpret the meaning of `command`.

Marker syntax rules:

1. The marker body begins with the command.
2. The command extends from the beginning of the marker to the first numeric argument or quoted string argument.
3. Command whitespace is normalized to single spaces, but letter case is preserved.
4. A marker with no arguments produces an empty `args` array.
5. The first argument follows the command after whitespace.
6. Additional arguments MUST be separated by commas.
7. Numeric arguments may be signed and may contain a decimal point.
8. String arguments MUST be enclosed in double quotes. Backslash may escape a quote or backslash inside a string.
9. Unquoted non-numeric values are considered part of the command before the first argument. After argument parsing has started, unquoted non-numeric values are invalid.
10. Invalid marker syntax is not emitted as a VPP marker event and SHOULD be logged diagnostically by VoicePrompter.

Examples:

```text
[CAM 1]
```

```json
{
  "command": "CAM",
  "args": [1]
}
```

```text
[SLIDE 12]
```

```json
{
  "command": "SLIDE",
  "args": [12]
}
```

```text
[VLC STOP]
```

```json
{
  "command": "VLC STOP",
  "args": []
}
```

```text
[OBS SCENE "Camera 1"]
```

```json
{
  "command": "OBS SCENE",
  "args": ["Camera 1"]
}
```

```text
[VLC PLAY 2, "Intro.mp4", 5]
```

```json
{
  "command": "VLC PLAY",
  "args": [2, "Intro.mp4", 5]
}
```

### progress

Reports that work associated with a previous call is still in progress. `correlationId` is required.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "correlationId": "<call-id>",
  "type": "progress",
  "data": {
    "message": "Processing",
    "percent": 10
  },
  "source": {
    "app": "VoicePrompter",
    "version": "..."
  },
  "timestamp": "2026-08-11T20:54:31.301+02:00"
}
```

Progress does not terminate the request.

### response

Terminal successful response to a call. `correlationId` is required.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "correlationId": "<call-id>",
  "type": "response",
  "result": {
    "success": true
  },
  "source": {
    "app": "VoicePrompter",
    "version": "..."
  },
  "timestamp": "2026-08-11T20:54:35.112+02:00"
}
```

### error

Terminal unsuccessful response to a call. `correlationId` is required when the error concerns a specific previous message.

```json
{
  "protocolVersion": 1,
  "id": "...",
  "correlationId": "<call-id>",
  "type": "error",
  "error": {
    "code": "METHOD_FAILED",
    "message": "Unable to execute requested operation",
    "details": {
      "reason": "Presentation is not active"
    }
  },
  "source": {
    "app": "VoicePrompter",
    "version": "..."
  },
  "timestamp": "2026-08-11T20:54:35.112+02:00"
}
```

`error.code` is a stable machine-readable identifier. `error.message` is human-readable. `error.details` is optional structured diagnostic data.

## VPBridge transport rule

VPBridge SHALL:

1. authenticate the WebSocket connection according to its own transport configuration;
2. accept messages only when the complete WebSocket message is syntactically valid JSON;
3. forward valid JSON unchanged to the opposite endpoint according to FIFO/buffer rules;
4. reject invalid JSON and record `DROPPED - INVALID JSON` in its diagnostic log.

VPBridge SHALL NOT validate or interpret `protocolVersion`, `id`, `correlationId`, `type`, `method`, `args`, `event`, `command`, `data`, `result`, `error`, `source`, or `timestamp`.

## Compatibility

Receivers SHOULD ignore unknown optional fields.

A receiver that cannot support a protocol version or requested method SHOULD return a protocol `error` when a response is possible.

Application version and Companion version are diagnostic metadata and do not replace `protocolVersion`.
