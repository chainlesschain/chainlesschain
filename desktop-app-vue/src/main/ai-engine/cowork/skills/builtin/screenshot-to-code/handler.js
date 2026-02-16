/**
 * Screenshot to Code Skill Handler
 *
 * Validates UI screenshot images and generates structured prompts
 * for vision-capable AI models to produce Vue/React/HTML component
 * code. Provides framework-specific templates and CSS utility patterns.
 * Modes: --analyze, --generate, --framework vue|react|html
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Supported formats ───────────────────────────────────────────────

const SUPPORTED_FORMATS = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ── Framework templates ─────────────────────────────────────────────

const TEMPLATES = {
  vue: {
    name: "Vue SFC",
    extension: ".vue",
    template:
      '<template>\n  <div class="{{componentName}}">\n    <!-- TODO: Replace with generated layout -->\n  </div>\n</template>\n\n<script setup>\nimport { ref, computed } from "vue"\n\n// TODO: Add reactive state and logic\n</script>\n\n<style scoped>\n.{{componentName}} {\n  /* TODO: Add extracted styles */\n}\n</style>',
    instructions: [
      "Use Vue 3 Composition API with <script setup>",
      "Use Ant Design Vue components where applicable (a-button, a-input, a-form, a-table)",
      "Use scoped CSS for component styles",
      "Prefer flex/grid for layout",
      "Use ref() for reactive state, computed() for derived values",
    ],
  },
  react: {
    name: "React JSX",
    extension: ".jsx",
    template:
      'import React, { useState } from "react";\nimport "./{{componentName}}.css";\n\nexport default function {{ComponentName}}() {\n  // TODO: Add state and handlers\n\n  return (\n    <div className="{{componentName}}">\n      {/* TODO: Replace with generated layout */}\n    </div>\n  );\n}',
    instructions: [
      "Use React functional components with hooks",
      "Use useState for local state, useEffect for side effects",
      "Use CSS modules or a separate CSS file",
      "Prefer flex/grid for layout",
      "Use semantic HTML elements",
    ],
  },
  html: {
    name: "Plain HTML",
    extension: ".html",
    template:
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>{{ComponentName}}</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }\n    /* TODO: Add extracted styles */\n  </style>\n</head>\n<body>\n  <div class="{{componentName}}">\n    <!-- TODO: Replace with generated layout -->\n  </div>\n</body>\n</html>',
    instructions: [
      "Use semantic HTML5 elements (header, nav, main, section, footer)",
      "Use CSS Grid and Flexbox for responsive layout",
      "Add mobile breakpoints (@media max-width: 768px)",
      "Use CSS custom properties for theming",
      "Ensure accessibility (alt text, ARIA labels, focus states)",
    ],
  },
};

const CSS_PATTERNS = {
  layout: [
    "display: flex; align-items: center; justify-content: center;",
    "display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;",
  ],
  card: [
    "border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 1.5rem;",
  ],
  button: [
    "padding: 0.5rem 1.5rem; border-radius: 4px; border: none; cursor: pointer; background: #1890ff; color: #fff;",
  ],
  input: [
    "padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 4px; font-size: 14px; width: 100%;",
  ],
  responsive: [
    "@media (max-width: 768px) { /* tablet */ }",
    "@media (max-width: 480px) { /* mobile */ }",
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────

function validateImage(imagePath) {
  if (!fs.existsSync(imagePath)) {
    return { valid: false, error: "File not found: " + imagePath };
  }
  const ext = path.extname(imagePath).toLowerCase();
  if (!SUPPORTED_FORMATS[ext]) {
    return {
      valid: false,
      error:
        "Unsupported format: " +
        ext +
        ". Supported: " +
        Object.keys(SUPPORTED_FORMATS).join(", "),
    };
  }
  const stats = fs.statSync(imagePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }
  if (stats.size > 50 * 1024 * 1024) {
    return { valid: false, error: "File too large (max 50 MB)" };
  }
  return {
    valid: true,
    info: {
      path: imagePath,
      fileName: path.basename(imagePath),
      format: ext.replace(".", "").toUpperCase(),
      mimeType: SUPPORTED_FORMATS[ext],
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
    },
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function deriveComponentName(imagePath) {
  const base = path.basename(imagePath, path.extname(imagePath));
  const pascal = base
    .replace(/[-_\s]+(.)/g, function (_, c) {
      return c.toUpperCase();
    })
    .replace(/^(.)/, function (_, c) {
      return c.toUpperCase();
    });
  const kebab = base
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
  return { pascal, kebab };
}

function buildAnalysisPrompt(imageInfo) {
  return (
    "Analyze this UI screenshot (" +
    imageInfo.format +
    ", " +
    imageInfo.sizeFormatted +
    ").\n\n" +
    "Describe the following:\n" +
    "1. Overall layout structure (header, sidebar, main content, footer)\n" +
    "2. Individual UI elements (buttons, inputs, cards, tables, charts, icons)\n" +
    "3. Color scheme (primary, secondary, background, text colors)\n" +
    "4. Typography (headings, body text, sizes, weights)\n" +
    "5. Spacing and alignment patterns\n" +
    "6. Interactive elements (dropdowns, modals, tabs, tooltips)\n" +
    "7. Responsive considerations (fixed vs fluid widths)\n\n" +
    "For each element, note its approximate position, size, and visual properties."
  );
}

function buildGenerationPrompt(imageInfo, framework, componentName) {
  const fw = TEMPLATES[framework];
  let prompt =
    "Generate a " +
    fw.name +
    " component from this UI screenshot (" +
    imageInfo.format +
    ", " +
    imageInfo.sizeFormatted +
    ").\n\n";
  prompt +=
    "Component name: " +
    componentName.pascal +
    "\nFile: " +
    componentName.pascal +
    fw.extension +
    "\n\n";
  prompt +=
    "Instructions:\n" +
    fw.instructions
      .map(function (i) {
        return "- " + i;
      })
      .join("\n") +
    "\n\n";
  prompt += "CSS Utility Patterns Available:\n";
  Object.entries(CSS_PATTERNS)
    .slice(0, 5)
    .forEach(function (pair) {
      prompt += "  " + pair[0] + ": " + pair[1][0] + "\n";
    });
  prompt +=
    "\nRequirements:\n- Match layout, colors, spacing, typography closely\n- Use semantic HTML\n- Add responsive CSS\n- Include placeholder text/data\n- Add comments for complex sections\n\nOutput the complete component code.";
  return prompt;
}

function renderTemplate(framework, componentName) {
  return TEMPLATES[framework].template
    .replace(/\{\{componentName\}\}/g, componentName.kebab)
    .replace(/\{\{ComponentName\}\}/g, componentName.pascal);
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[screenshot-to-code] init: " + (_skill?.name || "screenshot-to-code"),
    );
  },

  async execute(task, context, _skill) {
    const input = (task?.params?.input || task?.action || "").trim();
    const projectRoot =
      context?.projectRoot || context?.workspaceRoot || process.cwd();

    const isAnalyze = /--analyze/i.test(input);
    const hasGenerate = /--generate/i.test(input);
    const frameworkMatch = input.match(/--framework\s+(vue|react|html)/i);
    const framework = frameworkMatch ? frameworkMatch[1].toLowerCase() : "vue";

    // Extract image path (remove flags)
    const imagePart = input
      .replace(/--analyze|--generate|--framework\s+\S+/gi, "")
      .trim();
    if (!imagePart) {
      return {
        success: false,
        error: "No image path provided",
        message:
          "Usage: /screenshot-to-code --generate <image> [--framework vue|react|html]",
      };
    }

    const imagePath = path.isAbsolute(imagePart)
      ? imagePart
      : path.resolve(projectRoot, imagePart);

    try {
      const validation = validateImage(imagePath);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          message: "Image validation failed: " + validation.error,
        };
      }

      const imageInfo = validation.info;
      const componentName = deriveComponentName(imagePath);

      // Analyze-only mode
      if (isAnalyze && !hasGenerate) {
        const prompt = buildAnalysisPrompt(imageInfo);
        return {
          success: true,
          result: { imageInfo, mode: "analyze", prompt, framework },
          message:
            "Screenshot Analysis Prepared: " +
            imageInfo.fileName +
            "\nFormat: " +
            imageInfo.format +
            " (" +
            imageInfo.sizeFormatted +
            ")\n\nSend this prompt to a vision-capable model with the image:\n\n" +
            prompt,
        };
      }

      // Generate mode (default)
      const prompt = buildGenerationPrompt(imageInfo, framework, componentName);
      const templateCode = renderTemplate(framework, componentName);
      const fw = TEMPLATES[framework];

      return {
        success: true,
        result: {
          imageInfo,
          mode: "generate",
          framework,
          frameworkName: fw.name,
          componentName,
          outputFile: componentName.pascal + fw.extension,
          prompt,
          templateCode,
          cssPatterns: CSS_PATTERNS,
        },
        message:
          "Screenshot to Code: " +
          imageInfo.fileName +
          "\nFormat: " +
          imageInfo.format +
          " (" +
          imageInfo.sizeFormatted +
          ")\nFramework: " +
          fw.name +
          "\nComponent: " +
          componentName.pascal +
          fw.extension +
          "\n\nStarter template:\n\n" +
          templateCode +
          "\n\nSend prompt to a vision model with the image for full generation.",
      };
    } catch (err) {
      logger.error("[screenshot-to-code] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Screenshot to code failed: " + err.message,
      };
    }
  },
};
