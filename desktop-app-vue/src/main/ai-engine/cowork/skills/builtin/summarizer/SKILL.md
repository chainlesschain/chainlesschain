---
name: summarizer
display-name: Summarizer
description: Summarize URLs, PDFs, YouTube videos, and text content - extract key points and generate concise summaries
version: 1.2.0
category: knowledge
user-invocable: true
tags: [summarize, summary, url, text, youtube, pdf, key-points, extract]
capabilities: [url-summarization, text-summarization, file-summarization, key-point-extraction]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [summarize-url, summarize-text, summarize-file]
instructions: |
  Use this skill when the user wants to summarize content from URLs, text,
  or local files. Supports web pages, YouTube videos (via transcript),
  and plain text. Returns structured summaries with key points, word counts,
  and reading time estimates.
examples:
  - input: "summarize-url https://example.com/article"
    action: summarize-url
  - input: "summarize-text The quick brown fox jumped over the lazy dog..."
    action: summarize-text
  - input: "summarize-file /path/to/document.txt"
    action: summarize-file
  - input: "summarize-url https://youtube.com/watch?v=abc123"
    action: summarize-url
input-schema:
  type: string
  description: "Action followed by URL, text content, or file path"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    summary: { type: string }
    key_points: { type: array }
    word_count: { type: number }
    message: { type: string }
model-hints:
  context-window: medium
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Summarizer

Summarize URLs, text, files, and YouTube videos with key point extraction.

## Usage

```
/summarizer summarize-url <url>
/summarizer summarize-text <text content>
/summarizer summarize-file <file path>
```

## Actions

| Action | Description |
| --- | --- |
| `summarize-url` | Fetch and summarize content from a URL (web pages, YouTube) |
| `summarize-text` | Summarize provided text content directly |
| `summarize-file` | Read and summarize a local file |

## Features

- Extracts key points as a structured array
- Calculates word count and estimated reading time
- Handles HTML content by stripping tags
- YouTube video ID detection for transcript-based summarization
- Supports plain text, HTML, and Markdown files

## Examples

- Summarize a web article: `/summarizer summarize-url https://blog.example.com/post`
- Summarize text: `/summarizer summarize-text "Long text content here..."`
- Summarize a local file: `/summarizer summarize-file ./docs/report.txt`
