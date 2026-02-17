---
name: refactor
display-name: Refactor
description: Suggest and apply code refactoring improvements
version: 1.0.0
category: refactoring
user-invocable: true
tags: [code, refactor, improvement]
supported-file-types: [kt, java, py, js, ts, go]
os: [android, win32, darwin, linux]
handler: RefactorHandler
input-schema:
  - name: code
    type: string
    description: The code to refactor
    required: true
  - name: language
    type: string
    description: Programming language
    required: false
  - name: goals
    type: string
    description: Refactoring goals (readability, performance, etc.)
    required: false
execution-mode: local
---

# Refactor Skill

Analyzes code and suggests refactoring improvements.

## Usage

```
/refactor [code snippet]
```

## Options

- `--goals <goals>` - Comma-separated goals: readability, performance, maintainability, testability

## Examples

```
/refactor --goals=readability
fun process(data: List<Map<String, Any>>): List<String> {
    val result = mutableListOf<String>()
    for (d in data) {
        if (d["active"] == true) {
            result.add(d["name"].toString())
        }
    }
    return result
}
```
