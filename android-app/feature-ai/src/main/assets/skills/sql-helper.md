---
name: sql-helper
display-name: SQL Helper
description: SQL query assistance and optimization
version: 1.0.0
category: data
user-invocable: true
tags: [sql, database, query]
os: [android, win32, darwin, linux]
input-schema:
  - name: input
    type: string
    description: SQL query or description of what you need
    required: true
execution-mode: local
---

# SQL Helper Skill

Assists with SQL query writing, optimization, and explanation.

## Usage

```
/sql-helper [SQL query or description]
```

## Capabilities

- Write SQL from natural language descriptions
- Explain existing SQL queries
- Optimize slow queries
- Convert between SQL dialects

## Examples

```
/sql-helper Get all users who signed up in the last 30 days, ordered by most recent
```

```
/sql-helper explain SELECT u.*, COUNT(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id HAVING COUNT(o.id) > 5
```
