# VoicePrompter Transport Protocol (Draft)

> Status: Draft 0.1
>
> This document defines the transport protocol used by VoicePrompter to communicate with external applications.
>
> The protocol is transport-independent and may be used over WebSocket, MQTT, REST, files or future communication layers.

---

# Design Goals

- Simple
- Human readable
- JSON based
- Transport independent
- Versioned
- Backward compatible
- Easy to debug

---

# General Message Format

Every message consists of an envelope and a payload.

```json
{
    "protocolVersion": 1,
    "application": "VoicePrompter",
    "applicationVersion": "1.0.0",

    "messageId": "a7b9d32e",

    "timestamp": "2026-08-02T21:14:32.154Z",

    "type": "CueDetected",

    "source": "speech",

    "payload": {}
}
```

---

# Envelope

## protocolVersion

Version of the transport protocol.

Used to verify compatibility.

Example

```json
"protocolVersion": 1
```

---

## application

Application name.

Example

```json
"application": "VoicePrompter"
```

---

## applicationVersion

Application version.

Example

```json
"applicationVersion": "1.0.0"
```

---

## messageId

Unique identifier of the message.

May be used to acknowledge or reference previous messages.

Example

```json
"messageId": "a7b9d32e"
```

---

## timestamp

UTC timestamp.

Example

```json
"timestamp": "2026-08-02T21:14:32.154Z"
```

---

## source

Origin of the message.

Examples

```
speech

keyboard

mouse

transport

api

click
```

---

# Message Types

Examples

```
Hello

CueDetected

Command

RuntimeUpdate

Status
```

This list is expected to grow.

---

# CueDetected

Example

```json
{
    "protocolVersion": 1,

    "type": "CueDetected",

    "source": "speech",

    "payload": {

        "cueIndex": 4,

        "modifiers": [
            "!"
        ],

        "tokens": [
            "PLAY",
            "VIDEO",
            "ID",
            "47"
        ],

        "raw": "PLAY VIDEO ID \"47\""
    }
}
```

---

# Command

Example

```json
{
    "protocolVersion": 1,

    "type": "Command",

    "source": "transport",

    "payload": {

        "command": "Continue"
    }
}
```

---

# RuntimeUpdate

Runtime information does not modify the original document.

Example

```json
{
    "protocolVersion": 1,

    "type": "RuntimeUpdate",

    "payload": {

        "cueIndex": 4,

        "timeLeft": "00:01:24"
    }
}
```

---

# Hello

Optional handshake.

Example

```json
{
    "protocolVersion": 1,

    "type": "Hello",

    "application": "VoicePrompter",

    "applicationVersion": "1.0.0"
}
```

---

# Future Extensions

Possible future additions

- Capabilities
- Authentication
- Heartbeat
- Runtime Synchronization
- Document Synchronization
- Plugin Communication

---

# Compatibility

Applications should reject communication if the protocol version is unsupported.

Application version should only be used for diagnostics.

---

# Philosophy

The protocol only transfers information.

It never defines the meaning of individual Cue commands.

Cue interpretation always belongs to external software.