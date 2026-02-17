---
name: http-client
display-name: HTTP Client
description: HTTP请求工具（GET/POST/PUT/DELETE、自定义Header、Auth、响应格式化）
version: 1.0.0
category: development
user-invocable: true
tags: [http, api, request, rest, get, post, curl, fetch]
capabilities: [http_get, http_post, http_put, http_delete, http_head]
tools:
  - http_request
  - http_get
  - http_post
instructions: |
  Use this skill to send HTTP requests like a built-in Postman. Supports all HTTP
  methods (GET, POST, PUT, DELETE, PATCH, HEAD), custom headers, request body
  (JSON/form), authentication (Bearer, Basic, API Key), response formatting, and
  timing. Useful for API testing and debugging.
examples:
  - input: "/http-client --get https://api.example.com/users"
    output: "200 OK (120ms) - JSON response with 10 users"
  - input: '/http-client --post https://api.example.com/users --body ''{"name":"Alice"}'' --header ''Content-Type: application/json'''
    output: "201 Created (85ms) - User created"
  - input: "/http-client --get https://api.example.com/me --auth bearer:token123"
    output: "200 OK with auth - User profile returned"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# HTTP Client

HTTP 请求工具，类似内置 Postman。

## 功能

| 操作   | 命令                            | 说明             |
| ------ | ------------------------------- | ---------------- |
| GET    | `--get <url>`                   | 发送GET请求      |
| POST   | `--post <url> --body '<json>'`  | 发送POST请求     |
| PUT    | `--put <url> --body '<json>'`   | 发送PUT请求      |
| DELETE | `--delete <url>`                | 发送DELETE请求   |
| PATCH  | `--patch <url> --body '<json>'` | 发送PATCH请求    |
| HEAD   | `--head <url>`                  | 发送HEAD请求     |
| Header | `--header 'Key: Value'`         | 添加自定义Header |
| Auth   | `--auth bearer:<token>`         | Bearer认证       |
| Auth   | `--auth basic:<user>:<pass>`    | Basic认证        |
