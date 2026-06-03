/**
 * Frontend Design Skill Handler
 *
 * UI component and layout design: component, layout,
 * responsive, a11y, theme.
 */

const { logger } = require("../../../../../utils/logger.js");

// ── Mode definitions ─────────────────────────────────────────────
const MODES = {
  component: "component",
  layout: "layout",
  responsive: "responsive",
  a11y: "a11y",
  theme: "theme",
};

const BREAKPOINTS = {
  mobile: "320px - 767px",
  tablet: "768px - 1023px",
  desktop: "1024px - 1439px",
  wide: "1440px+",
};

const A11Y_CHECKLIST = [
  {
    category: "Semantic HTML",
    checks: [
      "Use proper heading hierarchy (h1-h6)",
      "Use landmark elements (nav, main, aside)",
      "Use button for actions, a for navigation",
    ],
  },
  {
    category: "Keyboard",
    checks: [
      "All interactive elements are focusable",
      "Tab order follows visual order",
      "Focus indicators are visible",
    ],
  },
  {
    category: "ARIA",
    checks: [
      "Add aria-label for icon-only buttons",
      "Use aria-live for dynamic content",
      "Add role attributes where semantic HTML is insufficient",
    ],
  },
  {
    category: "Visual",
    checks: [
      "Color contrast ratio >= 4.5:1 (text)",
      "Don't rely on color alone to convey information",
      "Text is resizable to 200% without loss",
    ],
  },
  {
    category: "Forms",
    checks: [
      "All inputs have associated labels",
      "Error messages are descriptive",
      "Required fields are indicated",
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function parseInput(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { mode: MODES.component, description: "" };
  }

  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (MODES[firstWord]) {
    return {
      mode: firstWord,
      description: input.slice(firstWord.length).trim(),
    };
  }
  return { mode: MODES.component, description: input };
}

function generateComponent(description) {
  const name = description
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const lines = [
    `# Component Design: ${description}`,
    "",
    `## Component: \`<${name} />\``,
    "",
    "### Props",
    "| Prop | Type | Default | Description |",
    "|------|------|---------|-------------|",
    "| variant | 'primary' \\| 'secondary' | 'primary' | Visual variant |",
    "| size | 'sm' \\| 'md' \\| 'lg' | 'md' | Component size |",
    "| disabled | boolean | false | Disable interactions |",
    "| loading | boolean | false | Show loading state |",
    "",
    "### States",
    "- **Default** - Normal appearance",
    "- **Hover** - Subtle highlight or cursor change",
    "- **Active/Pressed** - Darker shade or scale effect",
    "- **Focused** - Visible focus ring (2px solid)",
    "- **Disabled** - Reduced opacity (0.5), no pointer events",
    "- **Loading** - Spinner or skeleton placeholder",
    "",
    "### Events",
    "| Event | Payload | Description |",
    "|-------|---------|-------------|",
    "| @click | event | Click handler |",
    "| @change | value | Value changed |",
    "",
    "### Structure",
    "```vue",
    "<template>",
    `  <div class="${name.toLowerCase()}" :class="[variant, size, { disabled, loading }]">`,
    "    <slot />",
    "  </div>",
    "</template>",
    "```",
    "",
    "### Accessibility",
    "- Add `role` attribute if not using semantic HTML",
    "- Include `aria-disabled` when disabled",
    '- Show loading state with `aria-busy="true"`',
  ];

  return {
    output: lines.join("\n"),
    data: { method: "component", componentName: name },
  };
}

function generateLayout(description) {
  const lines = [
    `# Page Layout: ${description}`,
    "",
    "## Layout Structure",
    "```",
    "+--------------------------------------------------+",
    "| Header (fixed, z-index: 100)                     |",
    "+----------+---------------------------------------+",
    "| Sidebar  | Main Content                          |",
    "| (240px)  |                                       |",
    "|          | +-----------------------------------+ |",
    "| Nav      | | Content Area                      | |",
    "| items    | |                                   | |",
    "|          | +-----------------------------------+ |",
    "|          |                                       |",
    "+----------+---------------------------------------+",
    "| Footer                                           |",
    "+--------------------------------------------------+",
    "```",
    "",
    "## CSS Grid / Flexbox",
    "```css",
    ".layout {",
    "  display: grid;",
    "  grid-template-areas:",
    '    "header header"',
    '    "sidebar main"',
    '    "footer footer";',
    "  grid-template-columns: 240px 1fr;",
    "  grid-template-rows: 64px 1fr auto;",
    "  min-height: 100vh;",
    "}",
    "```",
    "",
    "## Responsive Behavior",
    "- **Desktop**: Full sidebar visible",
    "- **Tablet**: Collapsible sidebar (hamburger toggle)",
    "- **Mobile**: Bottom navigation replaces sidebar",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "layout", description },
  };
}

function generateResponsive(description) {
  const lines = [
    `# Responsive Design: ${description}`,
    "",
    "## Breakpoints",
    "",
    "| Name | Range | Columns | Gutter |",
    "|------|-------|---------|--------|",
  ];

  for (const [name, range] of Object.entries(BREAKPOINTS)) {
    const cols = name === "mobile" ? 4 : name === "tablet" ? 8 : 12;
    const gutter = name === "mobile" ? "16px" : "24px";
    lines.push(`| ${name} | ${range} | ${cols} | ${gutter} |`);
  }

  lines.push("");
  lines.push("## Media Queries");
  lines.push("```css");
  lines.push("/* Mobile first approach */");
  lines.push(".container { padding: 16px; }");
  lines.push("");
  lines.push("@media (min-width: 768px) {");
  lines.push("  .container { padding: 24px; max-width: 720px; }");
  lines.push("}");
  lines.push("");
  lines.push("@media (min-width: 1024px) {");
  lines.push("  .container { max-width: 960px; }");
  lines.push("}");
  lines.push("");
  lines.push("@media (min-width: 1440px) {");
  lines.push("  .container { max-width: 1200px; }");
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("## Adaptive Patterns");
  lines.push(
    "- **Stack → Side-by-side**: Cards stack on mobile, grid on desktop",
  );
  lines.push("- **Hide → Show**: Secondary content hidden on mobile");
  lines.push(
    "- **Simplify → Expand**: Condensed data on mobile, full table on desktop",
  );
  lines.push(
    "- **Bottom nav → Sidebar**: Mobile bottom bar becomes desktop sidebar",
  );

  return {
    output: lines.join("\n"),
    data: { method: "responsive", breakpoints: Object.keys(BREAKPOINTS) },
  };
}

function generateA11y(description) {
  const lines = [
    `# Accessibility Audit: ${description}`,
    "",
    "## WCAG 2.1 AA Compliance Checklist",
    "",
  ];

  for (const section of A11Y_CHECKLIST) {
    lines.push(`### ${section.category}`);
    for (const check of section.checks) {
      lines.push(`- [ ] ${check}`);
    }
    lines.push("");
  }

  lines.push("## Testing Tools");
  lines.push("- **Browser**: axe DevTools, Lighthouse accessibility audit");
  lines.push("- **Screen reader**: NVDA (Windows), VoiceOver (macOS)");
  lines.push("- **Keyboard**: Tab through entire page without mouse");
  lines.push("- **Color**: Use contrast checker for all text/background pairs");
  lines.push("");
  lines.push("## Common Fixes");
  lines.push("1. Add `alt` text to all `<img>` elements");
  lines.push("2. Ensure `<button>` and `<a>` have accessible names");
  lines.push("3. Add `lang` attribute to `<html>` element");
  lines.push("4. Use `prefers-reduced-motion` for animations");

  return {
    output: lines.join("\n"),
    data: { method: "a11y", categories: A11Y_CHECKLIST.map((s) => s.category) },
  };
}

function generateTheme(description) {
  const lines = [
    `# Theme System: ${description}`,
    "",
    "## Design Tokens",
    "",
    "### Colors",
    "```css",
    ":root {",
    "  /* Primary */",
    "  --color-primary-50: #eff6ff;",
    "  --color-primary-500: #3b82f6;",
    "  --color-primary-700: #1d4ed8;",
    "",
    "  /* Neutral */",
    "  --color-neutral-50: #fafafa;",
    "  --color-neutral-200: #e5e5e5;",
    "  --color-neutral-500: #737373;",
    "  --color-neutral-800: #262626;",
    "  --color-neutral-950: #0a0a0a;",
    "",
    "  /* Semantic */",
    "  --color-success: #22c55e;",
    "  --color-warning: #f59e0b;",
    "  --color-error: #ef4444;",
    "  --color-info: #3b82f6;",
    "}",
    "```",
    "",
    "### Dark Mode",
    "```css",
    '[data-theme="dark"] {',
    "  --color-neutral-50: #0a0a0a;",
    "  --color-neutral-200: #262626;",
    "  --color-neutral-500: #737373;",
    "  --color-neutral-800: #e5e5e5;",
    "  --color-neutral-950: #fafafa;",
    "}",
    "```",
    "",
    "### Typography",
    "```css",
    ":root {",
    "  --font-sans: 'Inter', system-ui, sans-serif;",
    "  --font-mono: 'JetBrains Mono', monospace;",
    "  --font-size-xs: 0.75rem;",
    "  --font-size-sm: 0.875rem;",
    "  --font-size-base: 1rem;",
    "  --font-size-lg: 1.125rem;",
    "  --font-size-xl: 1.25rem;",
    "}",
    "```",
    "",
    "### Spacing & Radius",
    "```css",
    ":root {",
    "  --space-1: 0.25rem;",
    "  --space-2: 0.5rem;",
    "  --space-4: 1rem;",
    "  --space-6: 1.5rem;",
    "  --space-8: 2rem;",
    "  --radius-sm: 4px;",
    "  --radius-md: 8px;",
    "  --radius-lg: 12px;",
    "  --radius-full: 9999px;",
    "}",
    "```",
    "",
    "## Implementation",
    "- Use CSS custom properties for all design tokens",
    "- Toggle themes via `data-theme` attribute on root element",
    "- Respect `prefers-color-scheme` media query for system preference",
    "- Store user preference in localStorage",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "theme", description },
  };
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[frontend-design] handler initialized for "${skill?.name || "frontend-design"}"`,
    );
  },

  async execute(task, context, _skill) {
    const raw = task?.params?.input || task?.input || task?.action || "";
    const { mode, description } = parseInput(raw);

    if (!description) {
      return {
        success: false,
        output:
          "Usage: /frontend-design [mode] <requirements>\nModes: component, layout, responsive, a11y, theme",
        error: "No description provided",
      };
    }

    try {
      let result;
      switch (mode) {
        case MODES.layout:
          result = generateLayout(description);
          break;
        case MODES.responsive:
          result = generateResponsive(description);
          break;
        case MODES.a11y:
          result = generateA11y(description);
          break;
        case MODES.theme:
          result = generateTheme(description);
          break;
        default:
          result = generateComponent(description);
          break;
      }

      logger.info(
        `[frontend-design] generated ${mode} for: ${description.slice(0, 60)}`,
      );

      return {
        success: true,
        output: result.output,
        result: result.data,
        message: `Generated ${mode} frontend design`,
      };
    } catch (err) {
      logger.error("[frontend-design] Error:", err.message);
      return {
        success: false,
        output: `Error: ${err.message}`,
        error: err.message,
      };
    }
  },
};
