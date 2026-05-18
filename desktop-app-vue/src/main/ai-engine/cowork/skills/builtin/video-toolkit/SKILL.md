---
name: video-toolkit
display-name: Video Toolkit
description: Video operations - info, thumbnails, extract audio, compress, clip, convert
version: 1.0.0
category: media
user-invocable: true
tags: [video, ffmpeg, compress, convert, thumbnail]
capabilities: [video-info, thumbnail, audio-extract, compress, clip, convert]
supported-file-types: [mp4, avi, mkv, mov, webm, wmv, flv]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill for video operations: get info, extract thumbnails, extract audio,
  compress, clip segments, and convert formats. Requires FFmpeg.
examples:
  - input: "/video-toolkit --info movie.mp4"
    output: "Video info: 1920x1080, 24fps, H.264, 2:15:30 duration"
  - input: "/video-toolkit --thumbnail video.mp4 --time 00:01:30"
    output: "Extracted thumbnail at 1:30"
  - input: "/video-toolkit --compress video.mp4 --quality 720p"
    output: "Compressed video from 1.2GB to 340MB"
author: ChainlessChain
---

# Video Toolkit

Comprehensive video processing toolkit powered by FFmpeg.

## Usage

```
/video-toolkit --info <file>                              Video metadata
/video-toolkit --thumbnail <file> [--time HH:MM:SS]       Extract frame
/video-toolkit --extract-audio <file> [--format mp3]      Extract audio track
/video-toolkit --compress <file> --quality 720p            Compress video
/video-toolkit --clip <file> --start 00:01:00 --end 00:02:00  Cut segment
/video-toolkit --convert <file> --to mp4                  Format conversion
```

## Compression Presets

| Quality | Resolution | Bitrate |
| ------- | ---------- | ------- |
| 1080p   | 1920×1080  | 4000k   |
| 720p    | 1280×720   | 2500k   |
| 480p    | 854×480    | 1000k   |
| 360p    | 640×360    | 500k    |

## Dependencies

- `fluent-ffmpeg` — FFmpeg wrapper
- `@ffmpeg-installer/ffmpeg` — FFmpeg binary
- `@ffprobe-installer/ffprobe` — FFprobe binary
