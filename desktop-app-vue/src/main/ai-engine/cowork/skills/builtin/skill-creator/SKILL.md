---
name: skill-creator
display-name: Skill Creator
description: Create, modify, test, and improve skills - scaffold new SKILL.md files with proper frontmatter, generate handler.js implementations, run test evaluations, and optimize skill descriptions for better triggering
version: 1.0.0
category: system
user-invocable: true
tags: [skill, creator, scaffold, meta, generator, template, test, improve]
capabilities:
  [
    skill-scaffolding,
    handler-generation,
    skill-testing,
    description-optimization,
    template-management,
  ]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [skill-scaffold, skill-test, skill-optimize, skill-validate]
instructions: |
  Use this skill when the user wants to create a new skill, modify an existing
  skill, test a skill with sample inputs, or optimize skill triggering. Follows
  the Agent Skills open standard with YAML frontmatter + Markdown body. Generates
  both SKILL.md and handler.js with proper structure. Makes descriptions slightly
  "pushy" for better triggering accuracy.
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

Create, test, and improve skills for the Agent Skills system.

## Usage

```
/skill-creator create <name> "<description>"
/skill-creator test <skill-name> "<test input>"
/skill-creator optimize <skill-name>
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
name: my-skill              # Unique identifier (lowercase, hyphens)
display-name: My Skill      # Human-readable name
description: What + When    # CRITICAL: include what it does AND when to use it
version: 1.0.0
category: development       # knowledge|automation|development|system|media|productivity
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
  async init(skill) { /* load dependencies */ },
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

| Action | Description |
| --- | --- |
| `create` | Scaffold SKILL.md + handler.js from name/description |
| `test` | Run skill with sample input and verify output |
| `optimize` | Improve description for better triggering accuracy |
| `validate` | Check SKILL.md format and required fields |
