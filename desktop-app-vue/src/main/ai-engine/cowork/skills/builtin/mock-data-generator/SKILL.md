---
name: mock-data-generator
display-name: Mock Data Generator
description: 模拟数据生成 - 从Schema或类型定义自动生成真实的测试数据
version: 1.0.0
category: development
user-invocable: true
tags: [mock, data, testing, faker, schema]
capabilities: [schema-parsing, data-generation, type-inference]
tools:
  - file_reader
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill to generate realistic mock/test data from type definitions or schemas.
  For --schema mode, read a TypeScript interface or JSON Schema file and generate matching
  mock data. For --type mode, generate data for a named type/entity (user, product, order).
  For --count mode, specify how many records to generate. Field names are used to infer
  appropriate data (name→person name, email→email, id→UUID, price→number, date→ISO date).
examples:
  - input: "/mock-data-generator --type user --count 5"
    output: "[{id: 'a1b2c3', name: 'Alice Chen', email: 'alice@example.com', age: 28, role: 'admin'}, ...]"
  - input: "/mock-data-generator --schema src/types/Product.ts"
    output: "Generated 3 Product records from TypeScript interface: {id, name, price, category, inStock, createdAt}."
  - input: "/mock-data-generator --type order --count 10 --locale zh-CN"
    output: "Generated 10 order records with Chinese locale data."
input-schema:
  type: object
  properties:
    mode:
      type: string
      enum: [schema, type, count]
    typeName:
      type: string
    count:
      type: number
output-schema:
  type: object
  properties:
    data: { type: array }
    schema: { type: object }
    count: { type: number }
model-hints:
  preferred: [claude-sonnet-4-5-20250929]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Mock Data Generator 技能

## 描述

从 Schema 或类型定义自动生成真实的测试数据。通过字段名推断数据类型（name→姓名、email→邮箱、id→UUID），生成逼真的 Mock 数据。

## 使用方法

```
/mock-data-generator [选项]
```

## 预定义类型

| 类型    | 字段                                            |
| ------- | ----------------------------------------------- |
| user    | id, name, email, age, role, avatar, createdAt   |
| product | id, name, price, category, description, inStock |
| order   | id, userId, items, total, status, createdAt     |
| post    | id, title, content, author, tags, publishedAt   |
| comment | id, postId, author, content, likes, createdAt   |
