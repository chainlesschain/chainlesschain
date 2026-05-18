---
name: code-complete
display-name: Code Complete
description: Provide code completion suggestions
version: 1.0.0
category: code
user-invocable: true
tags: [code, completion, autocomplete]
supported-file-types: [kt, java, py, js, ts, go]
os: [android, win32, darwin, linux]
input-schema:
  - name: code
    type: string
    description: Partial code to complete
    required: true
  - name: language
    type: string
    description: Programming language
    required: false
execution-mode: local
---

# Code Complete Skill

Provides intelligent code completion suggestions.

## Usage

```
/code-complete [partial code]
```

## Examples

```
/code-complete
class UserRepository {
    private val db: Database

    suspend fun getUserById(id: String):
```
