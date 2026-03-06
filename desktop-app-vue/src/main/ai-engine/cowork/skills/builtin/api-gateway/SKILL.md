---
name: api-gateway
display-name: API Gateway
description: Universal API gateway - connect to 100+ APIs with a unified interface, manage API keys, and chain API calls
version: 1.2.0
category: automation
user-invocable: true
tags: [api, gateway, http, rest, integration, automation, chain]
capabilities: [api-calling, endpoint-registration, api-chaining, key-management]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [api-call, api-register, api-list, api-chain]
instructions: |
  Use this skill when the user wants to make API calls, register API endpoints
  for reuse, list saved endpoints, or chain multiple API calls together.
  Supports GET, POST, PUT, DELETE methods with custom headers and body.
  Registered APIs persist in a local JSON configuration file.
examples:
  - input: "call GET https://api.github.com/users/octocat"
    action: call
  - input: "register github-user GET https://api.github.com/users/{username}"
    action: register
  - input: "list"
    action: list
  - input: "chain github-user:username=octocat -> jsonplaceholder-posts:userId={id}"
    action: chain
input-schema:
  type: string
  description: "Action (call|register|list|chain) followed by API details"
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

# API Gateway

Universal API gateway for connecting to any REST API with a unified interface.

## Usage

```
/api-gateway call <METHOD> <URL> [--headers key=value] [--body <json>]
/api-gateway register <name> <METHOD> <URL> [--headers key=value] [--description <text>]
/api-gateway list [--filter <name>]
/api-gateway chain <step1> -> <step2> -> <step3>
```

## Actions

- **call** - Make a single API call with method, URL, headers, and body
- **register** - Save a named API endpoint for reuse
- **list** - List all registered API endpoints
- **chain** - Chain multiple API calls, passing data between steps

## Examples

```
/api-gateway call GET https://api.github.com/repos/nodejs/node
/api-gateway call POST https://httpbin.org/post --body '{"key": "value"}'
/api-gateway register weather GET https://api.openweathermap.org/data/2.5/weather?q={city}
/api-gateway chain weather:city=London -> transform:extract=temp
```
