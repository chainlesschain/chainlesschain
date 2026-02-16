/**
 * ToolSkillMapper — Auto-group FunctionCaller tools into skill groups
 *
 * For built-in tools that don't have a SKILL.md covering them, this mapper
 * provides default skill groupings with instructions and examples.
 *
 * @module ToolSkillMapper
 */

const { logger } = require("../utils/logger.js");

/**
 * Default skill group definitions with matching patterns
 */
const SKILL_GROUPS = [
  {
    name: "file-operations",
    displayName: "File Operations",
    category: "core",
    match: [/^file_/, "file_reader", "file_writer", "file_editor"],
    instructions:
      "Use file operation tools to read, write, edit, and manage files. Always check if a file exists before writing. Use file_reader to inspect content before making edits.",
    examples: [
      {
        input: "Read a file",
        tool: "file_reader",
        params: { path: "README.md" },
      },
      {
        input: "Write content to file",
        tool: "file_writer",
        params: { path: "output.txt", content: "Hello" },
      },
    ],
  },
  {
    name: "code-generation",
    displayName: "Code Generation",
    category: "development",
    match: [
      /^html_gen/,
      /^css_gen/,
      /^js_gen/,
      "html_generator",
      "css_generator",
      "js_generator",
    ],
    instructions:
      "Generate HTML, CSS, or JavaScript code snippets. Provide clear specifications for the desired output. Generated code follows best practices and modern standards.",
    examples: [
      {
        input: "Generate a login form",
        tool: "html_generator",
        params: { description: "Login form with email and password" },
      },
    ],
  },
  {
    name: "git-operations",
    displayName: "Git Version Control",
    category: "development",
    match: [/^git_/],
    instructions:
      "Perform Git version control operations. Always check git_status before committing. Use git_diff to review changes before staging.",
    examples: [
      { input: "Check repo status", tool: "git_status", params: {} },
      { input: "View recent commits", tool: "git_log", params: { limit: 10 } },
    ],
  },
  {
    name: "data-processing",
    displayName: "Data Processing",
    category: "data",
    match: [
      "json_parser",
      "yaml_parser",
      "csv_parser",
      "data_analyzer",
      /^data_/,
    ],
    instructions:
      "Parse, transform, and analyze structured data in JSON, YAML, or CSV formats. Use data_analyzer for statistical summaries and insights.",
    examples: [
      {
        input: "Parse JSON data",
        tool: "json_parser",
        params: { data: '{"key": "value"}' },
      },
    ],
  },
  {
    name: "image-processing",
    displayName: "Image Processing",
    category: "media",
    match: [/^image_/, /^vision_/],
    instructions:
      "Process and analyze images. Supports resize, crop, format conversion, and AI-powered visual analysis. Use vision tools for OCR and object detection.",
    examples: [
      {
        input: "Analyze image content",
        tool: "vision_analyze",
        params: { imagePath: "photo.jpg" },
      },
    ],
  },
  {
    name: "office-documents",
    displayName: "Office Documents",
    category: "productivity",
    match: [/^tool_word/, /^tool_excel/, /^tool_ppt/, /^office_/],
    instructions:
      "Create and manipulate Office documents (Word, Excel, PowerPoint). Generate reports, spreadsheets, and presentations programmatically.",
    examples: [
      {
        input: "Generate Word document",
        tool: "tool_word_generate",
        params: { title: "Report", content: "..." },
      },
    ],
  },
  {
    name: "code-execution",
    displayName: "Code Execution",
    category: "development",
    match: [/^sandbox_/, /^python_/, /^exec_/],
    instructions:
      "Execute code in a sandboxed environment. Supports Python and JavaScript. Always review code before execution. Sandbox provides isolation for safe execution.",
    examples: [
      {
        input: "Run Python code",
        tool: "sandbox_execute",
        params: { language: "python", code: 'print("Hello")' },
      },
    ],
  },
  {
    name: "tts-voice",
    displayName: "Text-to-Speech",
    category: "media",
    match: [/^tts_/],
    instructions:
      "Convert text to speech audio. Supports multiple voices and languages. Use for accessibility features or audio content generation.",
    examples: [
      {
        input: "Convert text to speech",
        tool: "tts_generate",
        params: { text: "Hello world", voice: "default" },
      },
    ],
  },
  {
    name: "image-generation",
    displayName: "Image Generation",
    category: "media",
    match: [/^imagegen_/],
    instructions:
      "Generate images from text descriptions using AI models. Provide detailed, descriptive prompts for best results.",
    examples: [
      {
        input: "Generate an image",
        tool: "imagegen_create",
        params: { prompt: "A sunset over mountains" },
      },
    ],
  },
  {
    name: "memory-recall",
    displayName: "MemGPT Memory",
    category: "ai",
    match: [/^memgpt_/],
    instructions:
      "Access and manage persistent memory using MemGPT-style memory operations. Store important facts, retrieve context, and manage long-term memory for conversations.",
    examples: [
      {
        input: "Store a memory",
        tool: "memgpt_store",
        params: { key: "user_preference", value: "dark mode" },
      },
    ],
  },
];

class ToolSkillMapper {
  constructor() {
    this.groups = SKILL_GROUPS;
  }

  /**
   * Map ungrouped tools into skill groups
   * @param {Array} ungroupedTools - Tools without a skillName
   * @returns {Array<{skill: SkillManifestEntry}>} Array of skill manifest entries with their tool lists
   */
  mapTools(ungroupedTools) {
    const groupedTools = new Map(); // groupName -> tool names[]
    const matched = new Set();

    for (const tool of ungroupedTools) {
      for (const group of this.groups) {
        if (this._matchesTool(tool.name, group.match)) {
          if (!groupedTools.has(group.name)) {
            groupedTools.set(group.name, []);
          }
          groupedTools.get(group.name).push(tool.name);
          matched.add(tool.name);
          break; // Each tool matches at most one group
        }
      }
    }

    // Build skill manifests for groups that have matching tools
    const results = [];
    for (const group of this.groups) {
      const toolNames = groupedTools.get(group.name);
      if (!toolNames || toolNames.length === 0) {
        continue;
      }

      results.push({
        skill: {
          name: group.name,
          displayName: group.displayName,
          description: group.instructions.split(".")[0] + ".",
          category: group.category,
          instructions: group.instructions,
          examples: group.examples,
          toolNames,
          source: "tool-group",
          version: "1.0.0",
          tags: [group.category, group.name],
        },
      });
    }

    logger.info(
      "[ToolSkillMapper] Mapped %d/%d tools into %d groups",
      matched.size,
      ungroupedTools.length,
      results.length,
    );

    return results;
  }

  /**
   * Check if a tool name matches any of the group's patterns
   * @private
   * @param {string} toolName
   * @param {Array<string|RegExp>} patterns
   * @returns {boolean}
   */
  _matchesTool(toolName, patterns) {
    for (const pattern of patterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(toolName)) {
          return true;
        }
      } else if (typeof pattern === "string") {
        if (toolName === pattern) {
          return true;
        }
      }
    }
    return false;
  }
}

module.exports = { ToolSkillMapper, SKILL_GROUPS };
