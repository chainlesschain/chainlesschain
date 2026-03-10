---
name: api-design
display-name: API Design
description: Design RESTful APIs with best practices, conventions, and OpenAPI specs
version: 1.0.0
category: development
user-invocable: true
tags: [api, design, rest, openapi, development]
capabilities:
  [
    api-design,
    api-review,
    openapi-generation,
    versioning-strategy,
    error-design,
  ]
os: [win32, darwin, linux]
handler: ./handler.js
---

# API Design Skill

Design and review APIs following RESTful best practices and industry conventions.

## Usage

```
/api-design [mode] [requirements or file path]
```

## Modes

- **design** (default) - Design a new API from requirements
- **review** - Review existing API endpoints for issues
- **openapi** - Generate OpenAPI/Swagger specification
- **versioning** - Plan API versioning strategy
- **errors** - Design error codes and error response format

## Examples

```
/api-design design User management API with CRUD and roles
/api-design review src/routes/api.js
/api-design openapi E-commerce product catalog API
/api-design versioning Plan v2 migration for payment API
/api-design errors Design error handling for authentication service
```

## Output

API design document with endpoints, request/response schemas, status codes, and conventions.
