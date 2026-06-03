---
name: database-query
display-name: Database Query Helper
description: Generate, optimize, and explain SQL queries - supports SQLite, PostgreSQL, MySQL with schema introspection, migration generation, and query performance analysis
version: 1.0.0
category: development
user-invocable: true
tags: [sql, database, query, optimization, migration, schema, postgresql, mysql, sqlite]
capabilities: [sql-generation, query-optimization, schema-introspection, migration-generation, explain-plan]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [db-query, db-schema, db-optimize, db-migrate]
instructions: |
  Use this skill when the user needs help with SQL queries, database
  schema design, query optimization, or migration generation. Supports
  SQLite, PostgreSQL, and MySQL dialects. Can introspect the app's
  SQLite database for schema information.
examples:
  - input: "generate a query to find users who logged in this week"
    action: generate
  - input: "optimize SELECT * FROM orders WHERE status = 'pending'"
    action: optimize
  - input: "show schema for notes table"
    action: schema
  - input: "create migration to add email column to users"
    action: migrate
input-schema:
  type: string
  description: "Action (generate|optimize|schema|migrate|explain) followed by query or description"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    sql: { type: string }
    suggestions: { type: array }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: low
author: ChainlessChain
license: MIT
---

# Database Query Helper

Generate, optimize, and explain SQL queries.

## Usage

```
/database-query generate "<natural language description>"
/database-query optimize "<sql query>"
/database-query schema [table-name]
/database-query migrate "<description of change>"
/database-query explain "<sql query>"
```

## Supported Dialects

SQLite (default, app database), PostgreSQL, MySQL

## Features

- Natural language to SQL generation
- Query optimization suggestions (indexes, joins, subqueries)
- Schema introspection from app database
- Migration script generation (up/down)
- EXPLAIN plan analysis
