---
name: query-enhancer
display-name: Query Enhancer
description: RAG query optimization - rewrite, expand, decompose, and analyze search queries for better retrieval results
version: 1.0.0
category: knowledge
user-invocable: true
tags: [query, search, rag, rewrite, optimize, retrieve, semantic]
capabilities:
  [
    query-rewriting,
    multi-query-expansion,
    hyde-generation,
    query-decomposition,
    synonym-expansion,
    intent-analysis,
  ]
tools:
  - query_rewriter
  - query_expander
  - query_analyzer
os: [win32, darwin, linux]
handler: ./handler.js
instructions: |
  Use this skill when the user wants to optimize search queries for RAG retrieval.
  For --rewrite mode, generate multiple query variants using synonyms, rephrasing, and
  contextual expansion. For --multi mode, generate 3-5 diverse search queries from a
  single question. For --hyde mode, generate a hypothetical answer passage that would
  match the ideal document (Hypothetical Document Embedding). For --decompose mode,
  break a complex question into atomic sub-queries. For --expand mode, add related
  terms, synonyms, and context keywords. For --analyze mode, classify query intent,
  extract entities, and determine expected answer type. Always return structured output
  ready for downstream retrieval pipelines.
examples:
  - input: "/query-enhancer --rewrite How does the permission system handle delegation?"
    output: "Variants: 1) 'permission delegation mechanism implementation', 2) 'RBAC delegate temporary access grant', 3) 'DelegationManager permission transfer workflow', 4) 'how are permissions delegated between users in the access control system'"
  - input: "/query-enhancer --multi What causes memory leaks in Electron apps?"
    output: "Queries: 1) 'Electron memory leak causes', 2) 'BrowserWindow garbage collection issues', 3) 'IPC handler memory retention patterns', 4) 'Node.js event listener leak detection Electron', 5) 'Chrome DevTools heap snapshot Electron debugging'"
  - input: "/query-enhancer --hyde How does the hybrid search combine vector and BM25 results?"
    output: "Hypothetical passage: 'The hybrid search engine combines vector similarity search (60% weight) with BM25 keyword matching (40% weight) using Reciprocal Rank Fusion (RRF). Vector search finds semantically similar documents via embeddings, while BM25 handles exact keyword matches. Results are merged by computing reciprocal ranks...'"
  - input: "/query-enhancer --decompose How do I set up SSO with SAML and link it to my DID identity?"
    output: "Sub-queries: 1) 'How to configure SAML 2.0 SSO provider', 2) 'SAML assertion parsing and signature verification', 3) 'DID identity linking with SSO accounts', 4) 'Identity bridge bidirectional lookup DID SSO'"
  - input: "/query-enhancer --analyze What is the best way to optimize LLM token usage?"
    output: "Intent: how-to/optimization. Entities: ['LLM', 'token usage']. Expected answer: procedural/tutorial. Query type: open-ended. Suggested expansions: ['context engineering', 'KV-cache', 'token compression', 'prompt optimization']."
input-schema:
  type: object
  properties:
    action:
      type: string
      enum: [rewrite, multi, hyde, decompose, expand, analyze]
      description: Query enhancement action
    query:
      type: string
      description: The search query to enhance
output-schema:
  type: object
  properties:
    original: { type: string }
    action: { type: string }
    variants: { type: array }
    entities: { type: array }
    intent: { type: string }
    queryType: { type: string }
model-hints:
  preferred: [claude-opus-4-6, gpt-4o]
cost: free
author: ChainlessChain
license: MIT
homepage: https://github.com/nicekid1/ChainlessChain
repository: https://github.com/nicekid1/ChainlessChain
---

# Query Enhancer Skill

Optimize search queries for better RAG retrieval results using NLP heuristics.

## Usage

```
/query-enhancer [action] "<query>"
```

## Actions

| Action      | Flag          | Description                                                |
| ----------- | ------------- | ---------------------------------------------------------- |
| Rewrite     | `--rewrite`   | Generate multiple query variants with synonyms and context |
| Multi-Query | `--multi`     | Expand one question into 3-5 diverse search queries        |
| HyDE        | `--hyde`      | Generate a hypothetical answer passage for embedding       |
| Decompose   | `--decompose` | Break complex question into atomic sub-queries             |
| Expand      | `--expand`    | Add related terms, synonyms, and context keywords          |
| Analyze     | `--analyze`   | Classify intent, extract entities, determine answer type   |

## How It Works

1. **Rewrite**: Applies synonym substitution, rephrasing, and contextual expansion to produce 3-4 variant queries that cover different retrieval angles
2. **Multi-Query**: Generates 3-5 semantically diverse queries targeting different facets of the original question
3. **HyDE**: Creates a hypothetical document passage that would answer the query, useful for embedding-based retrieval where the answer embedding is closer to relevant documents
4. **Decompose**: Splits compound questions into independent sub-queries that can be searched separately and results merged
5. **Expand**: Enriches the query with related terms from a built-in synonym map and detected domain context
6. **Analyze**: Detects query type (who/what/when/where/why/how), extracts named entities and quoted terms, and classifies expected answer format
