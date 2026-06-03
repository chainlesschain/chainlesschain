---
name: frontend-design
display-name: Frontend Design
description: Design UI components, layouts, and responsive interfaces with accessibility
version: 1.0.0
category: design
user-invocable: true
tags: [frontend, design, ui, components, accessibility]
capabilities:
  [
    component-design,
    layout-planning,
    responsive-design,
    accessibility-audit,
    theme-design,
  ]
os: [win32, darwin, linux]
handler: ./handler.js
---

# Frontend Design Skill

Design UI components, page layouts, and responsive interfaces with accessibility in mind.

## Usage

```
/frontend-design [mode] [requirements or component name]
```

## Modes

- **component** (default) - Design a UI component with props, states, and variants
- **layout** - Plan page layout with sections and grid structure
- **responsive** - Design responsive breakpoints and adaptive behavior
- **a11y** - Accessibility audit and recommendations
- **theme** - Design a theme system with tokens and variables

## Examples

```
/frontend-design component Data table with sorting, filtering, and pagination
/frontend-design layout Dashboard page with sidebar, header, and widgets
/frontend-design responsive Navigation menu for mobile, tablet, and desktop
/frontend-design a11y Review login form for accessibility issues
/frontend-design theme Design dark/light theme with CSS custom properties
```

## Output

Design specifications with component structure, styles, states, and implementation guidance.
