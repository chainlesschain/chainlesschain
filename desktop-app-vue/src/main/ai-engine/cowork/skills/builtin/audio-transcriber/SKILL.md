---
name: audio-transcriber
display-name: Audio Transcriber
description: Speech-to-text transcription using Whisper API or local engine
version: 1.0.0
category: media
user-invocable: true
tags: [audio, speech, transcription, whisper, stt]
capabilities: [speech-to-text, multi-language, format-output]
supported-file-types: [mp3, wav, m4a, ogg, flac, webm]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill to transcribe audio files to text using Whisper API or local engines.
  Supports multiple output formats (text, SRT, JSON) and languages.
examples:
  - input: "/audio-transcriber --transcribe meeting.mp3"
    output: "Transcribed 45 minutes of audio to text"
  - input: "/audio-transcriber --transcribe lecture.wav --format srt"
    output: "Generated SRT subtitle file from audio"
author: ChainlessChain
---

# Audio Transcriber

Speech-to-text transcription using Whisper API or local engines.

## Usage

```
/audio-transcriber --transcribe <file> [--format txt|srt|json] [--language <lang>]
/audio-transcriber --info <file>
/audio-transcriber --providers
```

## Providers

| Provider    | Requirements                    |
| ----------- | ------------------------------- |
| Whisper API | OpenAI API key (OPENAI_API_KEY) |
| Local       | Local whisper binary or Ollama  |

## Dependencies

- `fluent-ffmpeg` — Audio preprocessing
- Audio processor module for format conversion
