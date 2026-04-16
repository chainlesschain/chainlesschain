/**
 * Project Style Analyzer for CLI
 *
 * Analyzes coding style, conventions, and patterns in a codebase using LLM.
 */

import fs from "fs";
import path from "path";
import { createChatFn } from "../cowork-adapter.js";
import { runPeerGroup } from "./agent-group-runner.js";

const CODE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".kt",
]);

/**
 * Analyze project coding style and conventions
 *
 * @param {object} params
 * @param {string} params.targetPath - File or directory to analyze
 * @param {object} [params.llmOptions] - LLM provider options
 * @returns {Promise<object>} Style analysis result
 */
export async function analyzeProjectStyle({ targetPath, llmOptions = {} }) {
  const chat = createChatFn(llmOptions);
  const stat = fs.statSync(targetPath);

  // Collect sample files
  const samples = [];
  if (stat.isDirectory()) {
    const files = collectSampleFiles(targetPath, 8);
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const relative = path.relative(process.cwd(), file);
        samples.push({
          path: relative,
          content: content.substring(0, 3000),
          ext: path.extname(file),
        });
      } catch {
        // Skip
      }
    }
  } else {
    const content = fs.readFileSync(targetPath, "utf-8");
    samples.push({
      path: path.relative(process.cwd(), targetPath),
      content: content.substring(0, 5000),
      ext: path.extname(targetPath),
    });
  }

  if (samples.length === 0) {
    return { patterns: [], summary: "No code files found to analyze." };
  }

  // Check for config files
  const configFiles = [];
  const configCandidates = [
    ".eslintrc.js",
    ".eslintrc.json",
    ".prettierrc",
    "tsconfig.json",
    "pyproject.toml",
    ".editorconfig",
    "biome.json",
  ];
  const baseDir = stat.isDirectory() ? targetPath : path.dirname(targetPath);
  for (const cf of configCandidates) {
    const cfPath = path.join(baseDir, cf);
    if (fs.existsSync(cfPath)) {
      try {
        configFiles.push({
          name: cf,
          content: fs.readFileSync(cfPath, "utf-8").substring(0, 2000),
        });
      } catch {
        // Skip
      }
    }
  }

  const codeContext = samples
    .map((s) => `--- ${s.path} ---\n${s.content}`)
    .join("\n\n");

  const configContext =
    configFiles.length > 0
      ? `\n\nConfiguration files:\n${configFiles.map((c) => `--- ${c.name} ---\n${c.content}`).join("\n\n")}`
      : "";

  const messages = [
    {
      role: "system",
      content: `You are a senior code reviewer analyzing project conventions. Identify:
1. Naming conventions (variables, functions, files)
2. Code organization patterns
3. Import/export style
4. Error handling patterns
5. Comment/documentation style
6. Testing patterns (if visible)
7. Formatting preferences (indentation, quotes, semicolons)

Be specific with examples from the code samples provided.`,
    },
    {
      role: "user",
      content: `Analyze the coding style and conventions in these ${samples.length} code samples:\n\n${codeContext}${configContext}\n\nProvide a structured analysis of the project's coding conventions and patterns.`,
    },
  ];

  // Single-peer AgentGroup (analyzer) — no coordinator. Keeps cowork
  // semantics uniform across debate/compare/analyze.
  const runResult = await runPeerGroup({
    peers: [
      {
        agentId: "style_analyzer",
        role: "Project Style Analyzer",
        taskTitle: `Analyze style (${targetPath})`,
        taskDescription: `${samples.length} samples, ${configFiles.length} config file(s)`,
      },
    ],
    metadata: { kind: "project-style-analyzer", targetPath },
    runPeer: async () => chat(messages, { maxTokens: 2000 }),
  });

  const outcome = runResult.results[0];
  if (outcome.ok) {
    const response = outcome.value;
    return {
      samplesAnalyzed: samples.length,
      configFilesFound: configFiles.map((c) => c.name),
      analysis: response,
      summary: `Style Analysis for: ${targetPath}\n  Samples: ${samples.length} files\n  Config: ${configFiles.map((c) => c.name).join(", ") || "none found"}\n\n${response}`,
      group: {
        groupId: runResult.groupId,
        parentAgentId: runResult.parentAgentId,
        members: runResult.members,
        tasks: runResult.tasks,
      },
    };
  }
  return {
    samplesAnalyzed: samples.length,
    summary: `Style analysis failed: ${outcome.error?.message || outcome.error}`,
    group: {
      groupId: runResult.groupId,
      parentAgentId: runResult.parentAgentId,
      members: runResult.members,
      tasks: runResult.tasks,
    },
  };
}

function collectSampleFiles(dir, maxFiles) {
  const files = [];
  const queue = [dir];

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist"
        ) {
          continue;
        }
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
          files.push(fullPath);
          if (files.length >= maxFiles) break;
        }
      }
    } catch {
      // Skip
    }
  }

  return files;
}
