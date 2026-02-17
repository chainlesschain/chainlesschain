---
name: subtitle-generator
display-name: Subtitle Generator
description: Generate SRT/VTT subtitles from media, convert formats, adjust timing
version: 1.0.0
category: media
user-invocable: true
tags: [subtitle, srt, vtt, caption, media]
capabilities: [subtitle-generation, format-conversion, timing-adjustment]
supported-file-types: [mp4, mp3, wav, srt, vtt]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill to generate subtitles from media files, convert between SRT and VTT formats,
  adjust subtitle timing, and translate subtitle text.
examples:
  - input: "/subtitle-generator --generate video.mp4 --format srt"
    output: "Generated SRT subtitles with timestamps"
  - input: "/subtitle-generator --convert subs.srt --to vtt"
    output: "Converted SRT to VTT format"
  - input: "/subtitle-generator --sync subs.srt --offset 2500"
    output: "Adjusted subtitle timing by +2.5 seconds"
author: ChainlessChain
---

# Subtitle Generator

Generate, convert, and adjust subtitles for media files.

## Usage

```
/subtitle-generator --generate <media-file> [--format srt|vtt] [--language en]
/subtitle-generator --convert <subtitle-file> --to srt|vtt
/subtitle-generator --sync <subtitle-file> --offset <ms>
/subtitle-generator --parse <subtitle-file>
/subtitle-generator --translate <subtitle-file> --to <lang>
```

## Features

- **Generate**: Extract audio → transcribe → create timed subtitles
- **Convert**: SRT ↔ VTT format conversion
- **Sync**: Adjust subtitle timing offset (positive/negative ms)
- **Parse**: Parse and display subtitle structure
- **Translate**: Prepare subtitle text for AI translation

## Dependencies

- `fluent-ffmpeg` — Audio extraction from video
- Whisper API or local engine for transcription
