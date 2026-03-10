---
name: multi-search-engine
display-name: Multi Search Engine
description: Zero-config multi-engine search aggregating 17 search engines (8 Chinese + 9 international) without API keys
version: 1.0.0
category: knowledge
user-invocable: true
tags: [search, multi-engine, web, research, baidu, google, duckduckgo, privacy]
capabilities: [web_search, multi_engine, search_aggregation, privacy_search]
tools:
  - web_search
  - web_fetch
handler: ./handler.js
instructions: |
  Use this skill to search across multiple search engines simultaneously.
  Generates search URLs for 17 engines (8 Chinese + 9 international).
  Supports advanced operators, time filtering, and privacy-focused engines.
examples:
  - input: "/multi-search-engine Vue3 best practices"
    output: "Search URLs for top 5 engines with Vue3 best practices query"
  - input: "/multi-search-engine --engine google,baidu machine learning"
    output: "Search URLs for Google and Baidu with machine learning query"
  - input: "/multi-search-engine --privacy secure messaging apps"
    output: "Search URLs for privacy-focused engines (DDG, Startpage, Brave, Qwant)"
os: [win32, darwin, linux]
author: ChainlessChain
---

# Multi Search Engine

## Description

Zero-configuration multi-engine search skill that aggregates 17 search engines without requiring any API keys. Generates ready-to-use search URLs with encoded parameters.

## Supported Engines

### Chinese (8)

| Engine             | Key     | Privacy |
| ------------------ | ------- | ------- |
| Baidu              | baidu   | No      |
| Bing CN            | bing-cn | No      |
| Bing International | bing    | No      |
| 360 Search         | 360     | No      |
| Sogou              | sogou   | No      |
| WeChat             | wechat  | No      |
| Toutiao            | toutiao | No      |
| Jisilu             | jisilu  | No      |

### International (9)

| Engine       | Key       | Privacy |
| ------------ | --------- | ------- |
| Google       | google    | No      |
| Google HK    | google-hk | No      |
| DuckDuckGo   | ddg       | Yes     |
| Yahoo        | yahoo     | No      |
| Startpage    | startpage | Yes     |
| Brave Search | brave     | Yes     |
| Ecosia       | ecosia    | No      |
| Qwant        | qwant     | Yes     |
| WolframAlpha | wolfram   | No      |

## Usage

```
/multi-search-engine <query>
/multi-search-engine --engine google,baidu <query>
/multi-search-engine --chinese <query>
/multi-search-engine --international <query>
/multi-search-engine --privacy <query>
/multi-search-engine --all <query>
/multi-search-engine --time week <query>
```

## Advanced Operators

- `site:example.com` - Search specific domain
- `filetype:pdf` - Search specific file type
- `"exact phrase"` - Exact match
- `-exclude` - Exclude term
