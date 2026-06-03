---
name: api-docs
display-name: API Documentation
description: Generate API documentation from code
version: 1.0.0
category: documentation
user-invocable: true
tags: [api, docs, documentation]
supported-file-types: [kt, java, py, js, ts]
os: [android, win32, darwin, linux]
input-schema:
  - name: code
    type: string
    description: The API code to document
    required: true
execution-mode: local
---

# API Documentation Generator

Generates comprehensive API documentation from source code.

## Usage

```
/api-docs [function/class code]
```

## Output

- Function/class description
- Parameters with types and descriptions
- Return value documentation
- Usage examples
- Error conditions

## Examples

```
/api-docs
suspend fun searchUsers(query: String, page: Int = 1, limit: Int = 20): PaginatedResult<User>
```
