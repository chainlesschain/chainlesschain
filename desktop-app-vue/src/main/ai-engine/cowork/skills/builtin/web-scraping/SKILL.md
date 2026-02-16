---
name: web-scraping
display-name: Web Scraping
description: Extract structured data from websites - scrape tables, lists, product info, text content
version: 1.0.0
category: data
user-invocable: true
tags: [scraping, data, extraction, web, table, crawl]
capabilities: [data-extraction, table-scraping, content-parsing, batch-scraping]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [scrape-page, extract-tables, extract-links, extract-text, batch-scrape]
instructions: |
  Use this skill when the user needs to collect structured data from web
  pages. Supports extracting tables, links, text content, and custom
  selectors. Can operate on single pages or batch multiple URLs.
examples:
  - input: "scrape tables from https://example.com/data"
    action: tables
  - input: "extract all links from the current page"
    action: links
  - input: "get text content from https://example.com"
    action: text
---

# Web Scraping Skill

Extract structured data from websites using the browser engine.

## Usage

```
/web-scraping <type> [url] [options]
```

## Extraction Types

| Type     | Description                            | Example                                                    |
| -------- | -------------------------------------- | ---------------------------------------------------------- |
| `tables` | Extract HTML tables as structured data | `/web-scraping tables https://example.com`                 |
| `links`  | Extract all links with text and href   | `/web-scraping links`                                      |
| `text`   | Extract main text content              | `/web-scraping text https://example.com`                   |
| `images` | Extract image URLs and alt text        | `/web-scraping images`                                     |
| `custom` | Extract using CSS selector             | `/web-scraping custom ".product-card" https://example.com` |
| `batch`  | Scrape multiple URLs                   | `/web-scraping batch urls.txt`                             |

## Output Formats

Results are returned as structured JSON. Use with workflow-automation for pipelines.
