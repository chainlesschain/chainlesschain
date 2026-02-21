---
name: stream-processor
display-name: Stream Processor
description: Process file streams with per-line transformations, filtering, and aggregation
version: 1.0.0
category: data
user-invocable: true
tags: [stream, processing, log, csv, json, filter, aggregate, data-pipeline]
capabilities:
  [line-by-line-processing, pattern-filtering, mode-detection, aggregation]
tools:
  - file_reader
instructions: |
  Use this skill to process file data streams line by line. Supports log, CSV,
  and JSON line formats. Can filter lines by regex pattern, count occurrences,
  extract fields, and produce summary aggregations.
  Usage: /stream-processor <source> [--mode log|csv|json] [--filter pattern]
examples:
  - input: "/stream-processor logs/app.log --filter ERROR"
    output: "Found 23 matching lines out of 1,450 total. Top errors: ..."
  - input: "/stream-processor data/users.csv --mode csv"
    output: "Processed 500 rows, 8 columns. Summary: ..."
  - input: "/stream-processor events.jsonl --mode json --filter status"
    output: "Processed 200 JSON lines. Field 'status' distribution: ..."
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Stream Processor

## Description

Process file data streams with per-line transformations, pattern filtering, and summary aggregation. Supports log, CSV, and JSON line formats.

## Usage

```
/stream-processor <source> [--mode log|csv|json] [--filter pattern]
```

## Modes

| Mode | Description                      | Auto-detect          |
| ---- | -------------------------------- | -------------------- |
| log  | Plain text / log file processing | `.log`, `.txt` files |
| csv  | CSV with header row              | `.csv`, `.tsv` files |
| json | JSON Lines (one object per line) | `.jsonl`, `.ndjson`  |

## Features

- **Filtering**: `--filter <regex>` filters lines matching the pattern
- **Auto-detect**: Mode is inferred from file extension if not specified
- **Aggregation**: Counts, top values, field distribution
- **Large files**: Streams line-by-line, no full-file memory load

## Output Example

```
Stream Processing Report
========================
Source: logs/app.log
Mode: log
Filter: ERROR
Lines: 1,450 total, 23 matched

Top Patterns:
  [ERROR] Database connection timeout — 12 occurrences
  [ERROR] Authentication failed — 8 occurrences
  [ERROR] File not found — 3 occurrences
```
