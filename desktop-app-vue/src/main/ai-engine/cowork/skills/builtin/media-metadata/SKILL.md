---
name: media-metadata
display-name: Media Metadata
description: Extract and display metadata from images, audio, and video files
version: 1.0.0
category: media
user-invocable: true
tags: [metadata, exif, media, image, audio, video]
capabilities: [image-metadata, audio-metadata, video-metadata, batch-extract]
supported-file-types:
  [jpg, jpeg, png, gif, webp, mp3, wav, flac, mp4, avi, mkv, mov]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
instructions: |
  Use this skill to extract metadata from media files including images (EXIF, dimensions),
  audio (duration, codec, bitrate), and video (resolution, FPS, codec). Supports batch extraction.
examples:
  - input: "/media-metadata --extract photo.jpg"
    output: "Image: 4032x3024, JPEG, 3.2MB, EXIF: Canon EOS R5, f/2.8, ISO 400"
  - input: "/media-metadata --batch ./media/"
    output: "Extracted metadata from 15 media files"
  - input: "/media-metadata --video clip.mp4"
    output: "Video: 1920x1080, H.264, 24fps, 5:32 duration"
author: ChainlessChain
---

# Media Metadata

Extract and display metadata from images, audio, and video files.

## Usage

```
/media-metadata --extract <file>          Auto-detect type and extract
/media-metadata --image <file>            Image metadata (EXIF, dimensions)
/media-metadata --audio <file>            Audio metadata (codec, duration)
/media-metadata --video <file>            Video metadata (resolution, FPS)
/media-metadata --batch <dir>             Batch extract from directory
/media-metadata --format json|table       Output format (default: table)
```

## Extracted Properties

### Images

- Dimensions, format, color space, channels, DPI
- EXIF: camera, lens, exposure, ISO, GPS coordinates

### Audio

- Duration, codec, sample rate, channels, bitrate

### Video

- Duration, resolution, FPS, video/audio codec, bitrate, subtitle tracks

## Dependencies

- `sharp` — Image metadata extraction
- `fluent-ffmpeg` — Audio/video metadata via ffprobe
