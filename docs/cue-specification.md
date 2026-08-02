# VoicePrompter Cue Language Specification (Draft)

> Status: Draft (Development Branch)
>
> This document defines the Cue Language used by VoicePrompter.
>
> It intentionally does **not** define the behavior of any Cue.
> The meaning of a Cue is determined entirely by external software.

---

# Philosophy

VoicePrompter does not execute Cue commands.

VoicePrompter only:

- detects Cue markers
- parses the Cue syntax
- publishes Cue events

The interpretation of a Cue belongs to external software.

Examples:

- Bitfocus Companion
- Home Assistant
- OBS
- VLC
- PowerPoint
- Future plugins

---

# Cue Syntax

Every Cue is enclosed in square brackets.

Examples:

```
[SLIDE 12]

[PLAY VIDEO "intro.mp4"]

[LIGHT STUDIO OFF]
```

---

# Cue Structure

A Cue consists of:

```
[ modifiers tokens... ]
```

Example:

```
[! PLAY VIDEO ID 47]
```

---

# Modifiers

Modifiers define additional Cue behavior.

They always appear immediately after the opening bracket.

Examples:

```
[! PLAY VIDEO]

[@ PLAY VIDEO]

[!? PLAY VIDEO]
```

Multiple modifiers may be combined.

VoicePrompter parses modifiers but does not interpret them.

---

# Tokens

Everything following the modifiers is treated as a sequence of tokens.

Example:

```
PLAY VIDEO ID 47
```

becomes

```
PLAY
VIDEO
ID
47
```

Quoted strings remain a single token.

Example:

```
PLAY VIDEO "intro.mp4"
```

becomes

```
PLAY
VIDEO
intro.mp4
```

VoicePrompter does not assign meaning to any token.

---

# Raw Text

The original Cue text is always preserved.

Example:

```
PLAY VIDEO ID 47
```

The original text must remain available exactly as entered.

---

# Parsing Result

A parsed Cue may be represented as:

```json
{
    "modifiers": ["!"],
    "tokens": [
        "PLAY",
        "VIDEO",
        "ID",
        "47"
    ],
    "raw": "PLAY VIDEO ID 47"
}
```

This structure is transport-independent.

---

# Event Model

Whenever a Cue is activated, VoicePrompter publishes an Event.

Example:

```json
{
    "type": "CueDetected",
    "cue": {
        "modifiers": ["!"],
        "tokens": [
            "PLAY",
            "VIDEO",
            "ID",
            "47"
        ],
        "raw": "PLAY VIDEO ID 47"
    },
    "source": "speech"
}
```

VoicePrompter does not execute the Cue.

---

# Runtime Data

Runtime data are not part of the Cue.

Example:

Original Cue:

```
[PLAY VIDEO "intro.mp4"]
```

Runtime UI:

```
[PLAY VIDEO "intro.mp4"]
Time Left: 00:01:24
```

The original Cue must never be modified.

Runtime information is temporary application state.

---

# Transport Independence

The Cue format is independent of the communication protocol.

Possible transports include:

- None
- Console
- Popup
- File
- WebSocket
- MQTT
- REST
- Future transports

---

# Extensibility

The Cue Language is intentionally generic.

VoicePrompter should never contain hardcoded commands such as:

```
PLAY
SLIDE
VIDEO
OBS
VLC
HA
```

These are interpreted exclusively by external software.

---

# Design Goals

- Minimal syntax
- Generic token model
- Platform independent
- Transport independent
- Easy to parse
- Easy to extend
- Backward compatible