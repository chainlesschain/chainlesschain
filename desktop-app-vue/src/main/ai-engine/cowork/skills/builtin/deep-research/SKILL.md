---
name: deep-research
display-name: Deep Research
description: Enterprise-grade deep research with multi-phase pipeline - autonomous web research, source credibility scoring, cross-referencing, synthesis, and validated reports for market analysis, competitive intel, and technical investigations
version: 1.0.0
category: knowledge
user-invocable: true
tags: [research, deep, autonomous, analysis, report, credibility, synthesis, investigation]
capabilities: [multi-phase-research, source-validation, credibility-scoring, cross-reference, synthesis-report]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [deep-research-start, deep-research-status, deep-research-report]
dependencies: [tavily-search, smart-search]
instructions: |
  Use this skill for comprehensive multi-phase research tasks requiring
  depth beyond simple web searches. Follows an 8-phase pipeline:
  1. Query decomposition 2. Broad search 3. Source collection
  4. Credibility scoring 5. Deep extraction 6. Cross-referencing
  7. Synthesis 8. Report generation. Ideal for market analysis,
  competitive intelligence, technical evaluations, and literature reviews.
examples:
  - input: "deep research on WebAssembly adoption in enterprise 2026"
    action: start
  - input: "research compare React vs Svelte for large-scale apps"
    action: start
  - input: "competitive analysis of vector database providers"
    action: start
input-schema:
  type: object
  properties:
    topic:
      type: string
    depth:
      type: string
      enum: [quick, standard, deep, exhaustive]
    focus:
      type: string
      enum: [technical, market, competitive, general]
output-schema:
  type: object
  properties:
    report: { type: object }
    sources: { type: array }
    confidence: { type: number }
model-hints:
  preferred: [claude-opus-4-6]
author: ChainlessChain
license: MIT
---

# Deep Research Skill

Enterprise-grade autonomous deep research with validated reports.

## Usage

```
/deep-research "<topic>" [--depth quick|standard|deep|exhaustive] [--focus technical|market|competitive]
/deep-research status
```

## 8-Phase Pipeline

| Phase | Description |
| --- | --- |
| 1. Decompose | Break topic into sub-queries |
| 2. Broad Search | Initial wide search for sources |
| 3. Collect | Gather and deduplicate sources |
| 4. Score | Rate source credibility (domain authority, recency, citations) |
| 5. Extract | Deep content extraction from top sources |
| 6. Cross-Reference | Verify claims across multiple sources |
| 7. Synthesize | Combine findings into coherent narrative |
| 8. Report | Generate structured report with citations |

## Depth Levels

| Level | Sub-queries | Sources | Time |
| --- | --- | --- | --- |
| `quick` | 2-3 | 5-10 | ~30s |
| `standard` | 4-6 | 10-20 | ~2min |
| `deep` | 8-12 | 20-40 | ~5min |
| `exhaustive` | 15-20 | 40-80 | ~15min |

## Report Structure

- Executive Summary
- Key Findings (ranked by confidence)
- Detailed Analysis (per sub-topic)
- Source Bibliography (with credibility scores)
- Methodology Notes
