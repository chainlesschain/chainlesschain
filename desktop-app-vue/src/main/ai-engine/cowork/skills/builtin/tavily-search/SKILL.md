---
name: tavily-search
display-name: Tavily Search
description: Real-time web search using Tavily API - search the web, extract page content, and get up-to-date information for RAG and research tasks
version: 1.0.0
category: knowledge
user-invocable: true
tags: [search, web, tavily, rag, realtime, extract, internet]
capabilities: [web-search, content-extraction, url-fetch, realtime-search]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [tavily-search, tavily-extract, web-search, url-extract]
instructions: |
  Use this skill when the user wants to search the web for current information,
  extract content from URLs, or needs up-to-date data that may not be in the
  local knowledge base. Supports both search (discovery) and extract (deep
  content retrieval) modes. Configure TAVILY_API_KEY in environment.
examples:
  - input: "search the web for latest Node.js security updates"
    action: search
  - input: "extract content from https://example.com/article"
    action: extract
  - input: "web search for React 19 new features"
    action: search
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [search, extract]
      description: Search mode - search for discovery, extract for deep content
    query:
      type: string
      description: Search query or URL to extract
    options:
      type: object
      properties:
        search_depth:
          type: string
          enum: [basic, advanced]
        max_results:
          type: number
output-schema:
  type: object
  properties:
    results: { type: array }
    query: { type: string }
    mode: { type: string }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: api-key-required
author: ChainlessChain
license: MIT
---

# Tavily Search Skill

Real-time web search and content extraction using the Tavily API.

## Usage

```
/tavily-search <query>
/tavily-search extract <url>
```

## Modes

| Mode | Description | Best For |
| --- | --- | --- |
| `search` (default) | Keyword-based web search | Initial research, finding sources |
| `extract` | Deep content extraction from URL | Detailed analysis, specific pages |

## Setup

Set the `TAVILY_API_KEY` environment variable:

```bash
export TAVILY_API_KEY=tvly-your-api-key-here
```

## Integration Pattern

1. Use `search` for the discovery phase
2. Analyze results to find relevant URLs
3. Use `extract` for detailed content on specific URLs
4. Process extracted content for user needs

## Options

| Option | Values | Description |
| --- | --- | --- |
| `search_depth` | `basic`, `advanced` | Search depth (advanced costs more) |
| `max_results` | 1-20 | Maximum results to return |
| `include_answer` | boolean | Include AI-generated answer summary |

## Cost Considerations

- Search is cheaper than extract
- Use search to filter relevant URLs first
- Only extract URLs that are likely relevant
- `basic` depth is sufficient for most queries
