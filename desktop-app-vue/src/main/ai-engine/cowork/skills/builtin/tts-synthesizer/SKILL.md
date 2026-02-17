---
name: tts-synthesizer
display-name: TTS Synthesizer
description: Text-to-speech synthesis - read documents, multiple voices and engines
version: 1.0.0
category: media
user-invocable: true
tags: [tts, speech, voice, audio, synthesis]
capabilities: [text-to-speech, multi-voice, multi-engine, file-reading]
supported-file-types: [txt, md]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill for text-to-speech synthesis. Can read text directly or from files,
  with support for multiple voices and TTS engines.
examples:
  - input: '/tts-synthesizer --speak "Hello world"'
    output: "Synthesized speech audio file"
  - input: "/tts-synthesizer --list-voices"
    output: "Available voices: en-US-Jenny, en-US-Guy, zh-CN-Xiaoxiao..."
  - input: "/tts-synthesizer --file document.txt --voice en-US-Jenny"
    output: "Synthesized document as speech audio"
author: ChainlessChain
---

# TTS Synthesizer

Text-to-speech synthesis with multiple voices and engines.

## Usage

```
/tts-synthesizer --speak <text> [--voice <name>] [--output <file>]
/tts-synthesizer --file <txt/md-file> [--voice <name>]
/tts-synthesizer --list-voices [--language <lang>]
/tts-synthesizer --providers
```

## Providers

| Engine | Description                       |
| ------ | --------------------------------- |
| edge   | Microsoft Edge TTS (free, online) |
| local  | Local system TTS                  |

## Dependencies

- TTS Manager module for synthesis
