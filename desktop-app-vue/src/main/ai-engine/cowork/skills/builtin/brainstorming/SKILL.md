---
name: brainstorming
display-name: Brainstorming
description: Creative ideation and structured brainstorming with multiple methodologies
version: 1.0.0
category: general
user-invocable: true
tags: [brainstorming, ideation, creativity, thinking]
capabilities: [idea-generation, mind-mapping, swot-analysis, six-hats, scamper]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Brainstorming Skill

Generate ideas and explore topics using structured brainstorming methodologies.

## Usage

```
/brainstorming [mode] [topic]
```

## Modes

- **ideate** (default) - Free brainstorming with categorized ideas
- **mindmap** - Structured mind map tree
- **swot** - SWOT analysis (Strengths, Weaknesses, Opportunities, Threats)
- **sixhats** - Six Thinking Hats method
- **scamper** - SCAMPER creative thinking method

## Examples

```
/brainstorming ideate How to improve developer onboarding
/brainstorming mindmap Microservice architecture decisions
/brainstorming swot Migrating from monolith to microservices
/brainstorming sixhats Should we adopt TypeScript?
/brainstorming scamper Improve our CI/CD pipeline
```

## Output

Structured ideas with categories, priorities, and actionable next steps.
