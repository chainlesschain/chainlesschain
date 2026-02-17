---
name: pptx-creator
display-name: PPTX Creator
description: Create PowerPoint presentations from outlines, Markdown, or templates
version: 1.0.0
category: document
user-invocable: true
tags: [powerpoint, pptx, presentation, slides]
capabilities: [slide-creation, theme-support, markdown-to-pptx]
supported-file-types: [pptx, md, txt]
os: [win32, darwin, linux]
handler: ./handler.js
tools:
  - file_read
  - file_write
instructions: |
  Use this skill to create PowerPoint presentations from text outlines or Markdown files.
  Supports multiple themes and slide layouts.
examples:
  - input: "/pptx-creator --from-md outline.md --output slides.pptx"
    output: "Created 12-slide presentation from Markdown outline"
  - input: '/pptx-creator --create "AI Overview" --template dark --output ai.pptx'
    output: "Created presentation with dark theme"
author: ChainlessChain
---

# PPTX Creator

Create PowerPoint presentations from outlines, Markdown, or templates.

## Usage

```
/pptx-creator --create <outline-text> [--output <file>] [--template <theme>]
/pptx-creator --from-md <file.md> [--output <file>] [--template <theme>]
/pptx-creator --list-templates
```

## Templates

| Theme        | Description                    |
| ------------ | ------------------------------ |
| professional | Clean business style (default) |
| dark         | Dark background, light text    |
| minimal      | Simple, minimal design         |
| colorful     | Vibrant colors and bold fonts  |

## Markdown Format

```markdown
# Presentation Title

## Slide Title

- Bullet point 1
- Bullet point 2

### Sub-section (content slide)

Regular paragraph text becomes slide content.
```

## Dependencies

- `pptxgenjs` — PowerPoint generation
