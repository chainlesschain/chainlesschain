---
name: ab-compare
display-name: A/B Compare
description: Generate and compare multiple implementation variants with benchmarking and scoring
version: 1.0.0
category: development
user-invocable: true
tags: [ab-test, compare, variants, benchmark, code-generation, multi-agent]
capabilities: [variant-generation, benchmarking, scoring, decision-recording]
tools:
  - agent_coordinator
  - code_reviewer
instructions: |
  Use this skill when the user wants to compare multiple implementation approaches.
  Generates N variants (default 3) using different agent profiles (concise, robust,
  readable, performant, testable), benchmarks each on error handling, readability,
  and conciseness, then ranks and selects a winner.
  Usage: /ab-compare "task description" [--variants 3] [--benchmark]
examples:
  - input: '/ab-compare "add input validation to login form"'
    output: "3 variants generated. Winner: robust-agent (score: 78/100)"
  - input: '/ab-compare "implement retry with exponential backoff" --variants 4'
    output: "4 variants compared. Winner: performant-agent (score: 82/100)"
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# A/B Compare

## Description

Generates multiple implementation variants for a task using different agent profiles, benchmarks each variant, and selects the best one.

## Usage

```
/ab-compare "task description" [--variants 3] [--benchmark]
```

## Agent Profiles

| Profile          | Strategy                                   |
| ---------------- | ------------------------------------------ |
| concise-agent    | Minimal code, one-liners, built-in methods |
| robust-agent     | Comprehensive error handling, edge cases   |
| readable-agent   | Self-documenting, clarity over brevity     |
| performant-agent | Optimized, minimal allocations             |
| testable-agent   | Pure functions, DI, clear interfaces       |

## Scoring

| Criterion      | Weight | Description                   |
| -------------- | ------ | ----------------------------- |
| Conciseness    | 30%    | Fewer lines = higher score    |
| Error Handling | 35%    | try/catch, null checks, throw |
| Readability    | 35%    | Line length, comments, naming |

## Output Format

```
A/B Comparison Report
=====================
Task: "add input validation to login form"
Variants: 3

| Agent          | Concise | Error | Readable | Total |
| -------------- | ------- | ----- | -------- | ----- |
| concise-agent  | 90      | 50    | 60       | 65    |
| robust-agent   | 40      | 95    | 70       | 78    |
| readable-agent | 60      | 65    | 90       | 73    |

Winner: robust-agent (78/100)
```
