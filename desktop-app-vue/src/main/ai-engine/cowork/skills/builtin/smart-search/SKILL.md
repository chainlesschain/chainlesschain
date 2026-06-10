---
name: smart-search
display-name: Smart Search
description: Use this to find specific existing info in your knowledge base via hybrid Vector+BM25 search—use when retrieving specific content to answer questions (not creating/writing docs); skip for formatting, external queries, or search method questions.
version: 1.0.0
category: knowledge
user-invocable: true
tags: [search, rag, semantic, knowledge, hybrid, vector, bm25]
capabilities:
  [semantic-search, keyword-search, hybrid-search, similarity-search]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [hybrid-search, vector-search, bm25-search, find-similar]
instructions: |
  Use this skill when the user wants to find information in their knowledge
  base, notes, or documents. Combines vector similarity search with BM25
  keyword matching for best results. Supports query refinement and
  similarity-based discovery.
examples:
  - input: "search WebRTC data channel configuration"
    action: search
  - input: "similar documents to the P2P architecture doc"
    action: similar
---

# Smart Search Skill

Search across your knowledge base using hybrid Vector+BM25 search.

## Usage

```
/smart-search <query>
/smart-search similar <document_reference>
```

## Search Modes

| Mode               | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `search` (default) | Hybrid search combining semantic and keyword matching |
| `similar`          | Find documents similar to a reference                 |
| `vector`           | Pure semantic/vector search                           |
| `keyword`          | Pure BM25 keyword search                              |

## How It Works

1. **Hybrid Search** (default): Combines vector similarity (60% weight) with BM25 keyword matching (40% weight) using Reciprocal Rank Fusion
2. **Vector Search**: Uses RAG embeddings for semantic similarity
3. **BM25 Search**: Okapi BM25 algorithm with Chinese/English tokenizer
4. **Performance**: <20ms search latency with parallel execution
