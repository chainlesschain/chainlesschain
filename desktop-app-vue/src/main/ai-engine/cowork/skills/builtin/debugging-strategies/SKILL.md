---
name: debugging-strategies
display-name: Debugging Strategies
description: Systematic debugging methodologies for diagnosing and resolving issues
version: 2.0.0
category: development
user-invocable: true
tags:
  [
    debugging,
    diagnosis,
    troubleshooting,
    development,
    root-cause-analysis,
    defense-in-depth,
  ]
capabilities:
  [
    systematic-diagnosis,
    binary-search,
    execution-tracing,
    hypothesis-testing,
    root-cause-analysis,
    red-flag-detection,
    defense-in-depth,
    session-tracking,
  ]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Debugging Strategies Skill

Apply systematic debugging methodologies to diagnose and resolve software issues. Includes the obra/superpowers systematic debugging methodology with root cause analysis, red flag detection, defense in depth validation, and session tracking.

## Usage

```
/debugging-strategies [mode] [error description or file path]
```

## Modes

### Core Modes

- **diagnose** (default) - Systematic diagnosis with checklist
- **bisect** - Binary search to isolate the problem
- **trace** - Execution trace analysis
- **hypothesis** - Hypothesis-driven debugging
- **rubber-duck** - Explain-to-debug methodology

### Advanced Modes

- **root-cause** - 4-phase systematic root cause analysis (Investigation, Pattern Analysis, Hypothesis Testing, Implementation) with 3-fix threshold rule
- **red-flags** - Detect anti-patterns in your debugging approach and rate quality (good/warning/danger)
- **defense** - Multi-layer validation strategy (input, business logic, data access, output) with code templates
- **session** - Track debugging sessions with timeline, hypotheses, and summaries

## Examples

```
/debugging-strategies diagnose TypeError: Cannot read property 'map' of undefined
/debugging-strategies bisect Feature broke between v1.2 and v1.5
/debugging-strategies trace src/main/database.js
/debugging-strategies hypothesis Memory leak in long-running process
/debugging-strategies rubber-duck Why does the login fail intermittently?
/debugging-strategies root-cause SQLITE_BUSY error during concurrent writes
/debugging-strategies red-flags I'll just try a quick fix for now, might work
/debugging-strategies defense TypeError in user registration endpoint
/debugging-strategies session start Login page crashes on submit
/debugging-strategies session log Added console.log to auth handler
/debugging-strategies session hypothesis Token refresh is racing with the login request
/debugging-strategies session summary
```

## Error Categories

The skill classifies errors into the following categories with targeted suggestions:

- **Type Error** - null/undefined, type mismatches, function signatures
- **Reference Error** - spelling, scope, imports, declaration order
- **Syntax Error** - brackets, quotes, missing punctuation
- **Range Error** - array bounds, recursion, numeric limits
- **File/Path Error** - missing files, working directory, permissions
- **Connection Error** - service availability, host/port, firewall
- **Permission Error** - file permissions, privileges, role access
- **Memory Error** - leaks, data size, memory limits
- **Promise/Async Error** - missing await, unhandled rejections, async return types
- **Import Error** - module names, package installation, relative paths
- **Database Error** - SQL syntax, connections, table existence, deadlocks
- **Network Error** - connectivity, host reachability, connection pools
- **Build Error** - source syntax, dependencies, cache, bundler config

## Red Flag Phrases

The red-flags mode detects these anti-patterns in your debugging description:

| Phrase                                      | Severity | Issue                     |
| ------------------------------------------- | -------- | ------------------------- |
| "quick fix for now" / "temporary fix"       | DANGER   | Temporary Fix Mindset     |
| "just try changing" / "let me try"          | WARNING  | Trial-and-Error Debugging |
| "don't fully understand but" / "might work" | DANGER   | Incomplete Understanding  |
| "works on my machine"                       | WARNING  | Environment Blindness     |
| "should be fine"                            | WARNING  | Unverified Assumption     |

## Session Tracking

Track your debugging progress across multiple steps:

1. `session start <problem>` - Begin a new session
2. `session log <entry>` - Record what you tried
3. `session hypothesis <h>` - Record and track hypotheses
4. `session summary` - View timeline, stats, and 3-fix threshold warnings

## Output

Debugging plan with ordered steps, likely causes ranked by probability, resolution strategies, validation checklists, and code templates.
