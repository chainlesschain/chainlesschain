/**
 * Decision Knowledge Base for CLI
 *
 * Extracts architectural decisions from code and documentation using LLM analysis.
 * Outputs structured ADR-like records.
 */

import fs from "fs";
import path from "path";
import { createChatFn } from "../cowork-adapter.js";

/**
 * Extract architectural decisions from a file or directory
 *
 * @param {object} params
 * @param {string} params.targetPath - File or directory to analyze
 * @param {object} [params.llmOptions] - LLM provider options
 * @returns {Promise<object>} Extracted decisions
 */
export async function extractDecisions({ targetPath, llmOptions = {} }) {
  const chat = createChatFn(llmOptions);
  const stat = fs.statSync(targetPath);

  let content;
  if (stat.isDirectory()) {
    // Read key files that typically contain decisions
    const candidates = [
      "CLAUDE.md",
      "CLAUDE-decisions.md",
      "README.md",
      "ARCHITECTURE.md",
      "ADR",
      "docs/adr",
      "docs/decisions",
      "package.json",
    ];
    const parts = [];
    for (const candidate of candidates) {
      const fullPath = path.join(targetPath, candidate);
      if (fs.existsSync(fullPath)) {
        const stat2 = fs.statSync(fullPath);
        if (stat2.isFile()) {
          try {
            const fileContent = fs.readFileSync(fullPath, "utf-8");
            parts.push(
              `--- ${candidate} ---\n${fileContent.substring(0, 5000)}`,
            );
          } catch {
            // Skip
          }
        } else if (stat2.isDirectory()) {
          // Read first few files in ADR directory
          try {
            const files = fs.readdirSync(fullPath).slice(0, 10);
            for (const f of files) {
              const fp = path.join(fullPath, f);
              if (fs.statSync(fp).isFile()) {
                const fc = fs.readFileSync(fp, "utf-8");
                parts.push(
                  `--- ${candidate}/${f} ---\n${fc.substring(0, 3000)}`,
                );
              }
            }
          } catch {
            // Skip
          }
        }
      }
    }
    content = parts.join("\n\n");
  } else {
    content = fs.readFileSync(targetPath, "utf-8");
  }

  if (!content || content.trim().length === 0) {
    return {
      decisions: [],
      summary: "No relevant content found for decision extraction.",
    };
  }

  // Truncate if too long
  if (content.length > 20000) {
    content = content.substring(0, 20000) + "\n... (truncated)";
  }

  const messages = [
    {
      role: "system",
      content: `You are an experienced software architect. Extract architectural decisions from the provided content. For each decision, identify:
1. Title — short name for the decision
2. Status — (accepted, proposed, deprecated, superseded)
3. Context — why was this decision needed?
4. Decision — what was decided?
5. Consequences — what are the trade-offs?

Format each decision as:
### Decision: <title>
- **Status**: <status>
- **Context**: <context>
- **Decision**: <what was decided>
- **Consequences**: <trade-offs>

List all decisions you can find. If no explicit decisions are documented, infer them from technology choices, patterns, and configuration.`,
    },
    {
      role: "user",
      content: `Extract architectural decisions from this content:\n\n${content}`,
    },
  ];

  try {
    const response = await chat(messages, { maxTokens: 2000 });
    const decisions = parseDecisions(response);

    return {
      decisions,
      raw: response,
      summary: `Found ${decisions.length} architectural decisions in ${targetPath}\n\n${decisions.map((d) => `  - ${d.title} (${d.status})`).join("\n")}`,
    };
  } catch (err) {
    return {
      decisions: [],
      summary: `Decision extraction failed: ${err.message}`,
    };
  }
}

function parseDecisions(text) {
  const decisions = [];
  const sections = text.split(/###\s*Decision:\s*/i);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split("\n");
    const title = lines[0].trim();

    const statusMatch = section.match(/\*\*Status\*\*:\s*(.+)/i);
    const contextMatch = section.match(/\*\*Context\*\*:\s*(.+)/i);
    const decisionMatch = section.match(/\*\*Decision\*\*:\s*(.+)/i);
    const consequencesMatch = section.match(/\*\*Consequences?\*\*:\s*(.+)/i);

    decisions.push({
      title,
      status: statusMatch ? statusMatch[1].trim() : "accepted",
      context: contextMatch ? contextMatch[1].trim() : "",
      decision: decisionMatch ? decisionMatch[1].trim() : "",
      consequences: consequencesMatch ? consequencesMatch[1].trim() : "",
    });
  }

  return decisions;
}
