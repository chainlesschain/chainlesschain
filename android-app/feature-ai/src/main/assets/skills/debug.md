---
name: debug
display-name: Debug Assistant
description: Analyze errors and suggest fixes
version: 1.0.0
category: debugging
user-invocable: true
tags: [debug, error, fix, troubleshoot]
os: [android, win32, darwin, linux]
handler: DebugHandler
input-schema:
  - name: error
    type: string
    description: The error message or description
    required: true
  - name: code
    type: string
    description: Related source code
    required: false
  - name: stackTrace
    type: string
    description: Stack trace
    required: false
execution-mode: local
---

# Debug Assistant Skill

Analyzes errors, exceptions, and bugs to suggest fixes.

## Usage

```
/debug [error message or description]
```

## Options

- `--code <code>` - Related source code for context
- `--stackTrace <trace>` - Stack trace information

## Examples

```
/debug java.lang.NullPointerException: Attempt to invoke virtual method on a null object reference
```

```
/debug --stackTrace "at com.example.MyActivity.onCreate(MyActivity.kt:42)"
Fatal Exception: kotlinx.coroutines.JobCancellationException
```
