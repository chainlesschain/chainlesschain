---
name: ultrathink
display-name: Ultra Think
description: Activate extended thinking mode for complex problems - deep reasoning, chain-of-thought decomposition, multi-step analysis, and thorough exploration before answering
version: 1.0.0
category: development
user-invocable: true
tags: [thinking, reasoning, analysis, chain-of-thought, deep-thinking, problem-solving]
capabilities: [extended-thinking, decomposition, multi-perspective, constraint-analysis, solution-synthesis]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [ultrathink-analyze, ultrathink-decompose, ultrathink-evaluate]
instructions: |
  Use this skill when the user needs deep analysis of complex problems,
  architecture decisions, debugging difficult issues, or thorough
  evaluation of trade-offs. Activates structured thinking with explicit
  reasoning steps, constraint analysis, and multi-perspective evaluation.
examples:
  - input: "think deeply about microservice vs monolith for our scale"
    action: analyze
  - input: "decompose the authentication flow redesign"
    action: decompose
  - input: "evaluate three caching strategies for our API"
    action: evaluate
input-schema:
  type: string
  description: "Optional action (analyze|decompose|evaluate) followed by problem description"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    thinking: { type: object }
    message: { type: string }
model-hints:
  context-window: large
  capability: reasoning
cost: medium
author: ChainlessChain
license: MIT
---

# Ultra Think

Extended thinking mode for complex problem solving.

## Usage

```
/ultrathink analyze "<complex problem or decision>"
/ultrathink decompose "<large task or system design>"
/ultrathink evaluate "<options to compare>"
```

## Thinking Modes

- **Analyze**: Deep dive into a single problem with constraint mapping and solution space exploration
- **Decompose**: Break complex tasks into sub-problems with dependency graphs
- **Evaluate**: Multi-criteria comparison of options with trade-off matrices

## Process

1. Problem restatement and clarification
2. Constraint and assumption identification
3. Multi-perspective analysis
4. Solution space exploration
5. Trade-off evaluation
6. Recommendation synthesis
