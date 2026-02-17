---
name: json-formatter
display-name: JSON Formatter
description: Format, validate, and transform JSON data
version: 1.0.0
category: general
user-invocable: true
tags: [json, format, validate]
os: [android, win32, darwin, linux]
input-schema:
  - name: input
    type: string
    description: JSON string to format or validate
    required: true
execution-mode: local
---

# JSON Formatter Skill

Formats, validates, and transforms JSON data.

## Usage

```
/json-formatter [JSON string]
```

## Capabilities

- Pretty-print JSON
- Validate JSON syntax
- Convert JSON to other formats
- Extract specific fields

## Examples

```
/json-formatter {"name":"John","age":30,"address":{"city":"NYC"}}
```
