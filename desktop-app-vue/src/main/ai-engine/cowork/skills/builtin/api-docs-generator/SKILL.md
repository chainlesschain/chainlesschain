---
name: api-docs-generator
display-name: API Docs Generator
description: Generate API documentation from code - produce OpenAPI/Swagger specs, Markdown API references, request/response examples, and interactive documentation from source code analysis
version: 1.0.0
category: development
user-invocable: true
tags: [api, documentation, openapi, swagger, rest, endpoint, reference]
capabilities: [openapi-generation, endpoint-extraction, example-generation, markdown-docs]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [api-docs-scan, api-docs-generate, api-docs-validate]
instructions: |
  Use this skill when the user needs to generate API documentation from
  source code, create OpenAPI specs, or produce endpoint references.
  Scans route files for Express, FastAPI, Spring Boot, etc. and generates
  structured documentation.
examples:
  - input: "generate API docs from src/routes/"
    action: scan
  - input: "create OpenAPI spec for the user service"
    action: openapi
  - input: "document this REST endpoint"
    action: endpoint
author: ChainlessChain
license: MIT
---

# API Docs Generator

Generate API documentation from source code.

## Usage

```
/api-docs-generator scan <path>
/api-docs-generator openapi <path> [--title "My API"]
/api-docs-generator endpoint "<method> <path> <description>"
/api-docs-generator validate <spec-file>
```

## Supported Frameworks

Express.js, Fastify, Koa, FastAPI, Flask, Django REST, Spring Boot, NestJS

## Output Formats

OpenAPI 3.0 YAML, Markdown reference, HTML (via Swagger UI)
