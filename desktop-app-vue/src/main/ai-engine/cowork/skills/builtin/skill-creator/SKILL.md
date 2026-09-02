---
name: skill-creator
display-name: Skill Creator
description: Propose, test, validate, and improve Skill candidates without changing active files - generate reviewable SKILL.md and handler.js drafts, run test evaluations, and optimize descriptions for better triggering
version: 1.2.0
category: system
user-invocable: true
tags:
  [
    skill,
    creator,
    scaffold,
    meta,
    generator,
    template,
    test,
    improve,
    optimize,
    eval,
  ]
capabilities:
  [
    skill-scaffolding,
    handler-generation,
    skill-testing,
    description-optimization,
    description-optimization-loop,
    template-management,
  ]
execution-capabilities: [data:result, data:task, filesystem:read, host:electron, host:environment, host:filesystem, host:logger, host:process, host:skill-registry, process:cwd, process:execute, runtime:random, runtime:time, system:inspect]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [skill-scaffold, skill-test, skill-optimize, skill-validate]
instructions: |
  Use this skill when the user wants to propose a new skill, review an improvement
  for an existing skill, test a skill with sample inputs, or optimize triggering.
  Follows the Agent Skills open standard with YAML frontmatter + Markdown body.
  The create and optimize-description actions return candidate bytes and diffs for
  review; they never persist or activate them. Use a governed candidate store and
  promotion controller before changing an active Skill.
examples:
  - input: "create a skill for data validation"
    action: create
  - input: "test the smart-search skill with sample queries"
    action: test
  - input: "optimize the description of browser-automation"
    action: optimize
  - input: "validate my-skill SKILL.md format"
    action: validate
author: ChainlessChain
license: MIT
---

# Skill Creator

Propose, test, validate, and improve Skill candidates without mutating active
Skill files.

## Usage

```
/skill-creator create <name> "<description>"
/skill-creator test <skill-name> "<test input>"
/skill-creator optimize <skill-name>
/skill-creator optimize <skill-name> --advanced [--iterations N]
/skill-creator optimize-description <skill-name> [--iterations N]
/skill-creator validate <skill-path>
/skill-creator list-templates
```

## Skill Anatomy

```
skill-name/
├── SKILL.md          (required) YAML frontmatter + Markdown instructions
└── handler.js        (required) init() + execute() exports
```

### SKILL.md Structure

```yaml
---
name: my-skill # Unique identifier (lowercase, hyphens)
display-name: My Skill # Human-readable name
description: What + When # CRITICAL: include what it does AND when to use it
version: 1.0.0
category: development # knowledge|automation|development|system|media|productivity
user-invocable: true
tags: [relevant, keywords]
capabilities: [what-it-can-do]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [tool-names]
instructions: |
  When to use this skill and how
examples:
  - input: "example command"
    action: action-name
---
# Skill Title

## Usage
## Actions
## Examples
```

### handler.js Structure

```javascript
module.exports = {
  async init(skill) {
    /* load dependencies */
  },
  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    // Parse input, execute action, return result
    return { success: true, action, result, message };
  },
};
```

## Writing Tips

- **Description**: Include both what + when. Be slightly "pushy" for better triggering
- **Keep SKILL.md under 500 lines**; use reference files for more
- **Progressive Disclosure**: Metadata always loaded, body loaded on trigger
- **Examples are crucial**: Include 2-4 realistic usage examples
- **Test early**: Create test cases after initial draft

## Actions

| Action                 | Description                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create`               | Return an in-memory SKILL.md + handler.js candidate and diff; do not persist or activate it                            |
| `test`                 | Run skill with sample input and verify output                                                                          |
| `optimize`             | Quick heuristic check on description (length, keywords)                                                                |
| `optimize-description` | LLM-driven eval loop that returns proposed SKILL.md content, a diff, and in-band evidence; active bytes stay unchanged |
| `validate`             | Check SKILL.md format and required fields                                                                              |
