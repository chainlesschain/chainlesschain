/**
 * Doc Co-authoring Skill Handler
 *
 * Collaborative documentation writing: draft, expand,
 * review, structure, glossary.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Mode definitions ─────────────────────────────────────────────
const MODES = {
  draft: "draft",
  expand: "expand",
  review: "review",
  structure: "structure",
  glossary: "glossary",
};

const DOC_QUALITY_CHECKS = [
  {
    pattern: /TODO|FIXME|TBD|WIP/gi,
    severity: "warning",
    message: "Incomplete placeholder found",
  },
  {
    pattern: /\[.*?\]\((?!https?:\/\/|#|\.\/|\.\.\/)\)/g,
    severity: "info",
    message: "Potentially broken link",
  },
  {
    pattern: /^#{1,6}\s*$/gm,
    severity: "warning",
    message: "Empty heading found",
  },
  {
    pattern: /```\s*\n\s*```/g,
    severity: "info",
    message: "Empty code block found",
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function parseInput(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { mode: MODES.draft, description: "" };
  }

  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (MODES[firstWord]) {
    return {
      mode: firstWord,
      description: input.slice(firstWord.length).trim(),
    };
  }
  return { mode: MODES.draft, description: input };
}

function generateDraft(topic) {
  const lines = [
    `# ${topic}`,
    "",
    "## Overview",
    `_(Provide a high-level introduction to ${topic})_`,
    "",
    "## Prerequisites",
    "- _(List what readers need to know beforehand)_",
    "",
    "## Getting Started",
    "",
    "### Step 1: Setup",
    "_(Describe initial setup steps)_",
    "",
    "### Step 2: Configuration",
    "_(Describe configuration options)_",
    "",
    "### Step 3: Usage",
    "_(Describe basic usage)_",
    "",
    "## API Reference",
    "_(If applicable, document the API)_",
    "",
    "## Examples",
    "```",
    "// Add usage examples here",
    "```",
    "",
    "## Troubleshooting",
    "| Problem | Solution |",
    "|---------|----------|",
    "| | |",
    "",
    "## FAQ",
    "**Q: Common question?**",
    "A: Answer here.",
    "",
    "## See Also",
    "- _(Related documentation links)_",
  ];

  return {
    output: lines.join("\n"),
    data: {
      method: "draft",
      topic,
      sections: [
        "Overview",
        "Prerequisites",
        "Getting Started",
        "API Reference",
        "Examples",
        "Troubleshooting",
        "FAQ",
      ],
    },
  };
}

function generateExpand(description, context) {
  const projectRoot =
    context?.projectRoot || context?.workspaceRoot || process.cwd();

  // Check if description contains a file path (with optional #section)
  const parts = description.split("#");
  const filePath = parts[0].trim();
  const section = parts[1] ? parts[1].trim() : null;
  const fullPath = path.resolve(projectRoot, filePath);

  let existingContent = "";
  try {
    existingContent = fs.readFileSync(fullPath, "utf-8");
  } catch {
    // File not found — generate from topic
  }

  const lines = [`# Expand: ${description}`, ""];

  if (existingContent && section) {
    // Find the section in existing content
    const headingPattern = new RegExp(
      `^#{1,6}\\s+${section.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`,
      "im",
    );
    const match = existingContent.match(headingPattern);
    if (match) {
      lines.push(`Found section "${section}" in ${filePath}.`);
      lines.push("");
    }
  }

  lines.push("## Expansion Suggestions");
  lines.push("");
  lines.push("### Add More Detail");
  lines.push("- Add code examples for each concept");
  lines.push("- Include diagrams or flowcharts");
  lines.push("- Add input/output examples");
  lines.push("");
  lines.push("### Add Context");
  lines.push("- Explain *why* not just *what*");
  lines.push("- Add common pitfalls and how to avoid them");
  lines.push("- Include performance considerations");
  lines.push("");
  lines.push("### Add References");
  lines.push("- Cross-reference related sections");
  lines.push("- Link to external resources");
  lines.push("- Add a glossary for technical terms");

  return {
    output: lines.join("\n"),
    data: {
      method: "expand",
      file: filePath,
      section,
      fileFound: !!existingContent,
    },
  };
}

function generateReview(description, context) {
  const projectRoot =
    context?.projectRoot || context?.workspaceRoot || process.cwd();
  const fullPath = path.resolve(projectRoot, description);
  const issues = [];
  let content = "";
  let wordCount = 0;
  let headings = [];

  try {
    content = fs.readFileSync(fullPath, "utf-8");
    wordCount = content.split(/\s+/).filter(Boolean).length;

    // Extract headings
    const headingMatches = content.match(/^#{1,6}\s+.+$/gm) || [];
    headings = headingMatches.map((h) => h.trim());

    // Run quality checks
    for (const { pattern, severity, message } of DOC_QUALITY_CHECKS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split("\n").length;
        issues.push({
          line: lineNum,
          severity,
          message,
          snippet: match[0].slice(0, 40),
        });
      }
    }

    // Check for missing sections
    const hasExamples = /example/i.test(content);
    const hasTroubleshooting = /troubleshoot/i.test(content);
    if (!hasExamples) {
      issues.push({
        severity: "info",
        message: "No examples section found — consider adding one",
      });
    }
    if (!hasTroubleshooting) {
      issues.push({
        severity: "info",
        message: "No troubleshooting section found",
      });
    }
  } catch {
    issues.push({
      severity: "warning",
      message: `Could not read file: ${description}`,
    });
  }

  const lines = [
    `# Documentation Review: ${description}`,
    "",
    `**Words:** ${wordCount}`,
    `**Headings:** ${headings.length}`,
    `**Issues:** ${issues.length}`,
    "",
  ];

  if (headings.length > 0) {
    lines.push("## Structure");
    for (const h of headings) {
      const level = (h.match(/^#+/) || [""])[0].length;
      lines.push(`${"  ".repeat(level - 1)}- ${h.replace(/^#+\s+/, "")}`);
    }
    lines.push("");
  }

  lines.push("## Issues");
  if (issues.length === 0) {
    lines.push("No issues found. Documentation looks good!");
  } else {
    for (const issue of issues) {
      const loc = issue.line ? ` (line ${issue.line})` : "";
      lines.push(`- [${issue.severity}]${loc} ${issue.message}`);
    }
  }

  lines.push("");
  lines.push("## Recommendations");
  lines.push("1. Address any warnings above");
  lines.push("2. Review heading hierarchy for consistency");
  lines.push("3. Ensure all code examples are tested and up-to-date");

  return {
    output: lines.join("\n"),
    data: {
      method: "review",
      file: description,
      wordCount,
      headingCount: headings.length,
      issueCount: issues.length,
      issues,
    },
  };
}

function generateStructure(description, context) {
  const projectRoot =
    context?.projectRoot || context?.workspaceRoot || process.cwd();
  const fullPath = path.resolve(projectRoot, description);
  let headings = [];

  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const headingMatches = content.match(/^#{1,6}\s+.+$/gm) || [];
    headings = headingMatches.map((h) => ({
      level: (h.match(/^#+/) || [""])[0].length,
      text: h.replace(/^#+\s+/, ""),
    }));
  } catch {
    // Generate suggested structure from topic
  }

  const lines = [`# Document Structure: ${description}`, ""];

  if (headings.length > 0) {
    lines.push("## Current Structure");
    for (const h of headings) {
      lines.push(`${"  ".repeat(h.level - 1)}- ${h.text}`);
    }
    lines.push("");

    // Check for issues
    const issues = [];
    if (headings[0]?.level !== 1) {
      issues.push("Document should start with a single H1 heading");
    }
    let prevLevel = 0;
    for (const h of headings) {
      if (h.level > prevLevel + 1) {
        issues.push(
          `Heading level skip: jumped from H${prevLevel} to H${h.level} at "${h.text}"`,
        );
      }
      prevLevel = h.level;
    }

    if (issues.length > 0) {
      lines.push("## Structure Issues");
      for (const issue of issues) {
        lines.push(`- ${issue}`);
      }
      lines.push("");
    }
  }

  lines.push("## Recommended Structure");
  lines.push("```");
  lines.push("# Title (H1 - only one)");
  lines.push("## Overview (H2)");
  lines.push("## Getting Started (H2)");
  lines.push("### Prerequisites (H3)");
  lines.push("### Installation (H3)");
  lines.push("## Usage (H2)");
  lines.push("### Basic Usage (H3)");
  lines.push("### Advanced Usage (H3)");
  lines.push("## API Reference (H2)");
  lines.push("## Configuration (H2)");
  lines.push("## Troubleshooting (H2)");
  lines.push("## Contributing (H2)");
  lines.push("```");

  return {
    output: lines.join("\n"),
    data: {
      method: "structure",
      file: description,
      headingCount: headings.length,
    },
  };
}

function generateGlossary(description, context) {
  const projectRoot =
    context?.projectRoot || context?.workspaceRoot || process.cwd();
  const fullPath = path.resolve(projectRoot, description);
  const terms = new Map();

  try {
    const content = fs.readFileSync(fullPath, "utf-8");

    // Extract bold terms (likely definitions)
    const boldMatches = content.match(/\*\*([^*]+)\*\*/g) || [];
    for (const m of boldMatches) {
      const term = m.replace(/\*\*/g, "").trim();
      if (term.length > 2 && term.length < 50) {
        terms.set(term, "_(definition needed)_");
      }
    }

    // Extract code terms
    const codeMatches = content.match(/`([^`]+)`/g) || [];
    for (const m of codeMatches) {
      const term = m.replace(/`/g, "").trim();
      if (term.length > 2 && term.length < 40 && !/[{}()=<>]/.test(term)) {
        terms.set(term, "_(definition needed)_");
      }
    }
  } catch {
    // Generate empty glossary template
  }

  const lines = [`# Glossary: ${description}`, ""];

  if (terms.size > 0) {
    lines.push(`Found ${terms.size} potential terms:`);
    lines.push("");

    const sorted = [...terms.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [term, def] of sorted.slice(0, 30)) {
      lines.push(`**${term}**: ${def}`);
      lines.push("");
    }
  } else {
    lines.push("## Template");
    lines.push("");
    lines.push("**Term 1**: Definition of term 1.");
    lines.push("");
    lines.push("**Term 2**: Definition of term 2.");
    lines.push("");
    lines.push("**Term 3**: Definition of term 3.");
  }

  lines.push("");
  lines.push("---");
  lines.push("_Fill in definitions for each term. Remove irrelevant entries._");

  return {
    output: lines.join("\n"),
    data: { method: "glossary", file: description, termCount: terms.size },
  };
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[doc-coauthoring] handler initialized for "${skill?.name || "doc-coauthoring"}"`,
    );
  },

  async execute(task, context, _skill) {
    const raw = task?.params?.input || task?.input || task?.action || "";
    const { mode, description } = parseInput(raw);

    if (!description && mode !== MODES.draft) {
      return {
        success: false,
        output:
          "Usage: /doc-coauthoring [mode] <topic or file>\nModes: draft, expand, review, structure, glossary",
        error: "No description provided",
      };
    }

    if (!description) {
      return {
        success: false,
        output: "Usage: /doc-coauthoring draft <topic>",
        error: "No topic provided",
      };
    }

    try {
      let result;
      switch (mode) {
        case MODES.expand:
          result = generateExpand(description, context);
          break;
        case MODES.review:
          result = generateReview(description, context);
          break;
        case MODES.structure:
          result = generateStructure(description, context);
          break;
        case MODES.glossary:
          result = generateGlossary(description, context);
          break;
        default:
          result = generateDraft(description);
          break;
      }

      logger.info(
        `[doc-coauthoring] generated ${mode} for: ${description.slice(0, 60)}`,
      );

      return {
        success: true,
        output: result.output,
        result: result.data,
        message: `Generated ${mode} documentation`,
      };
    } catch (err) {
      logger.error("[doc-coauthoring] Error:", err.message);
      return {
        success: false,
        output: `Error: ${err.message}`,
        error: err.message,
      };
    }
  },
};
