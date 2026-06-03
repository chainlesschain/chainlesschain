---
name: news-monitor
display-name: News Monitor
description: Monitor news feeds, tech blogs, and competitive intelligence sources - track keywords, summarize articles, detect trends, and deliver digests on schedule
version: 1.0.0
category: knowledge
user-invocable: true
tags: [news, monitoring, rss, intelligence, trends, digest, competitive-analysis]
capabilities: [rss-parsing, keyword-tracking, trend-detection, digest-generation, source-management]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [news-watch, news-digest, news-sources, news-trends]
instructions: |
  Use this skill when the user wants to monitor news, track topics,
  get article summaries, or build competitive intelligence feeds.
  Supports RSS/Atom feeds, keyword alerts, trend analysis, and
  scheduled digest delivery.
examples:
  - input: "monitor AI news from techcrunch and hackernews"
    action: watch
  - input: "generate weekly digest for blockchain topics"
    action: digest
  - input: "what are trending topics in machine learning"
    action: trends
  - input: "add source https://feeds.example.com/rss"
    action: source
input-schema:
  type: string
  description: "Action followed by keywords, URLs, or topic names"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    articles: { type: array }
    trends: { type: array }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# News Monitor

Track news, blogs, and competitive intelligence in real time.

## Usage

```
/news-monitor watch <keywords> [--sources hackernews,techcrunch,reddit]
/news-monitor digest [--period daily|weekly] [--topic <topic>]
/news-monitor trends [--category tech|ai|crypto|business]
/news-monitor source add|remove|list [url]
```

## Built-in Sources

HackerNews (API), TechCrunch, ArsTechnica, The Verge, Reddit (subreddits), GitHub Trending

## Features

- Keyword-based article filtering and scoring
- Trend detection via frequency analysis
- Digest generation with summaries
- Source management (add/remove RSS feeds)
