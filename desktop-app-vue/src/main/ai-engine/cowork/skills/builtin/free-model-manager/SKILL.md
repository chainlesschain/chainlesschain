---
name: free-model-manager
display-name: Free Model Manager
description: Free AI model management - discover, download, and manage free/open-source AI models from Ollama, HuggingFace, and other sources
version: 1.2.0
category: system
user-invocable: true
tags: [ai, models, ollama, huggingface, llm, open-source, download, management]
capabilities: [model-listing, model-pulling, model-search, model-info, model-removal]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [model-list, model-pull, model-search, model-info, model-remove]
instructions: |
  Use this skill when the user wants to discover, download, or manage
  free/open-source AI models. Integrates with Ollama for local model
  management and HuggingFace for model discovery. Supports listing
  installed models, pulling new ones, searching available models,
  getting model info, and removing models.
examples:
  - input: "list-local"
    action: list-local
  - input: "pull llama3:8b"
    action: pull
  - input: "search code generation"
    action: search
  - input: "info llama3:8b"
    action: info
  - input: "remove llama3:8b"
    action: remove
input-schema:
  type: string
  description: "Action (list-local|pull|search|info|remove) followed by model name or search query"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    result: { type: object }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Free Model Manager

Discover, download, and manage free/open-source AI models.

## Usage

```
/free-model-manager list-local
/free-model-manager pull <model-name>
/free-model-manager search <query> [--source ollama|huggingface]
/free-model-manager info <model-name>
/free-model-manager remove <model-name>
```

## Actions

- **list-local** - List all locally installed models via Ollama
- **pull** - Download a model from Ollama registry
- **search** - Search for available models on Ollama or HuggingFace
- **info** - Get detailed information about a specific model
- **remove** - Remove a locally installed model

## Examples

```
/free-model-manager list-local
/free-model-manager pull qwen2:7b
/free-model-manager search "code generation" --source huggingface
/free-model-manager info codellama:13b
/free-model-manager remove unused-model:latest
```
