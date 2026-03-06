---
name: youtube-summarizer
display-name: YouTube Summarizer
description: Summarize YouTube videos by extracting transcripts and generating structured summaries with key points, timestamps, and topic segmentation
version: 1.0.0
category: knowledge
user-invocable: true
tags: [youtube, video, summary, transcript, learning, notes]
capabilities: [transcript-extraction, summary-generation, timestamp-mapping, topic-segmentation]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [yt-summarize, yt-transcript, yt-chapters]
instructions: |
  Use this skill when the user wants to summarize a YouTube video,
  extract its transcript, or generate study notes from video content.
  Extracts captions/subtitles via YouTube's timedtext API and produces
  structured summaries.
examples:
  - input: "summarize https://youtube.com/watch?v=abc123"
    action: summarize
  - input: "transcript https://youtu.be/abc123"
    action: transcript
  - input: "chapters https://youtube.com/watch?v=abc123"
    action: chapters
input-schema:
  type: string
  description: "Action (summarize|transcript|chapters) followed by YouTube URL"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    videoId: { type: string }
    summary: { type: object }
    transcript: { type: array }
    message: { type: string }
model-hints:
  context-window: medium
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# YouTube Summarizer

Extract transcripts and generate summaries from YouTube videos.

## Usage

```
/youtube-summarizer summarize <youtube-url> [--lang en]
/youtube-summarizer transcript <youtube-url>
/youtube-summarizer chapters <youtube-url>
```

## Features

- Auto-detect video ID from various YouTube URL formats
- Extract auto-generated or manual captions
- Generate structured summaries with key points
- Topic-based chapter segmentation
- Timestamp-linked notes
