# VoicePrompter Architecture (Draft)

> Status: Draft (Development Branch)
>
> This document describes the long-term architectural direction for the VoicePrompter project and its integration with external systems such as Bitfocus Companion.
>
> The purpose of this document is to keep the architecture simple, modular and suitable for future Pull Requests to the upstream project.

---

# Core Philosophy

VoicePrompter is not only a teleprompter.

It is an **event-driven application**.

The application should not contain any logic specific to external software or hardware.

VoicePrompter only:

- generates Events
- receives Commands
- executes internal application logic

Everything else belongs to the Transport Layer.

---

# Architectural Principles

- Single Responsibility
- Event Driven
- Transport Independent
- Platform Independent
- Backward Compatible
- Easy to Extend
- Easy to Test
- Suitable for Upstream Pull Requests

---

# High Level Architecture

```text
                    Events
                       │
                       ▼
                Event Dispatcher
                       │
                       ▼
               Transport Manager
                       ▲
                       │
                    Commands
                       ▲
                       │
              Command Dispatcher
                       ▲
                       │
 Speech │ Keyboard │ Mouse │ API │ Transport
```

---

# Events

Events describe something that has already happened.

Examples:

```
SpeechStarted
SpeechStopped

WordChanged
ParagraphChanged

CueDetected

DocumentLoaded
DocumentClosed

VoiceCommandRecognized
```

Events never execute application logic.

They only describe what happened.

---

# Commands

Commands describe what the application should do.

Examples:

```
NextWord
PreviousWord

NextParagraph
PreviousParagraph

GotoCue

GotoBeginning
GotoEnd

PauseRecognition
ResumeRecognition
```

Commands are always executed through the Command Dispatcher.

No component should call application logic directly.

---

# Command Sources

Commands may originate from any source.

Examples:

```
Speech Recognition

Keyboard

Mouse

Transport Layer

Future Plugin

Future API
```

Every source produces exactly the same Command object.

The application should not care where the Command originated.

---

# Event Sources

Events may originate from:

```
Speech Engine

Navigation

Document Parser

Cue Detection

Application State
```

---

# Event Dispatcher

The Event Dispatcher distributes Events.

Possible listeners:

```
Console

Popup

File

WebSocket

MQTT

REST

Future transports...
```

One Event may have zero, one or many listeners.

---

# Command Dispatcher

The Command Dispatcher executes Commands.

Every Command has exactly one executor.

Example:

```
NextParagraph

↓

Navigation Controller

↓

Scroll Document
```

---

# Transport Layer

The Transport Layer is responsible only for communication.

It must never contain application logic.

Possible implementations:

```
None

Console

Popup

File

WebSocket

MQTT

REST

Named Pipe

Future transports...
```

The application must be able to run without any Transport enabled.

---

# Cue Philosophy

Cue markers are treated as Events.

Example:

```
[SLIDE 12]
```

becomes

```json
{
    "type": "CueDetected",
    "text": "SLIDE 12",
    "source": "speech"
}
```

VoicePrompter does **not** interpret the Cue.

It only publishes the Event.

External software decides what the Cue means.

Examples:

- Bitfocus Companion
- Home Assistant
- OBS
- VLC
- PowerPoint

---

# Voice Commands

Voice commands are transformed into generic Commands.

Example:

```
"go next"
```

↓

```json
{
    "type": "command",
    "name": "NextParagraph",
    "source": "speech"
}
```

Exactly the same Command may also originate from:

- keyboard shortcut
- mouse
- WebSocket
- REST
- plugin
- Companion

The application executes all Commands identically.

---

# External Integrations

VoicePrompter must never contain code such as:

```
Play VLC

Next PowerPoint Slide

OBS Scene Change

Home Assistant

Companion Actions
```

Those belong to external software.

VoicePrompter remains platform independent.

---

# Future Transport Examples

Outgoing:

```
CueDetected

WordChanged

ParagraphChanged

SpeechStarted

SpeechStopped

VoiceCommandRecognized
```

Incoming:

```
NextParagraph

PreviousParagraph

GotoCue

GotoWord

GotoBeginning

GotoEnd
```

---

# Future Runtime Feedback

The architecture must support runtime feedback coming from external systems.

Example:

```
[PLAY VLC "intro.mp4"]
```

Later displayed as:

```
[PLAY VLC "intro.mp4"]
Time Left: 00:01:24
```

The original Cue must remain unchanged.

Runtime information is temporary UI state.

---

# Long-Term Goal

VoicePrompter becomes an extensible platform where:

- Events are generated.
- Commands are executed.
- Transport is interchangeable.
- External systems remain independent.

This architecture keeps the project simple while allowing powerful integrations with systems such as Bitfocus Companion, Home Assistant, OBS, PowerPoint, VLC and future plugins without coupling VoicePrompter to any specific ecosystem.