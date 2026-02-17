---
name: explain-code
display-name: Explain Code
description: Explain code in plain language at different detail levels
version: 1.0.0
category: learning
user-invocable: true
tags: [code, explain, learning]
supported-file-types: [kt, java, py, js, ts, go, rs, c, cpp, sql, sh]
os: [android, win32, darwin, linux]
handler: ExplainCodeHandler
input-schema:
  - name: code
    type: string
    description: The code to explain
    required: true
  - name: level
    type: string
    description: Detail level (brief, normal, detailed)
    required: false
execution-mode: local
---

# Explain Code Skill

Provides clear explanations of code snippets.

## Usage

```
/explain-code [code snippet]
```

## Options

- `--level <level>` - Detail level: brief, normal, detailed (default: normal)
- `--language <lang>` - Programming language hint

## Examples

```
/explain-code
suspend fun fetchData(url: String): Result<Data> {
    return withContext(Dispatchers.IO) {
        try { Result.success(api.get(url)) }
        catch (e: Exception) { Result.failure(e) }
    }
}
```
