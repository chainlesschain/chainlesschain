/**
 * SkillSynthesizer — Automatically creates SKILL.md files from
 * successful complex execution trajectories.
 *
 * Trigger conditions (all must be met):
 *   1. tool_count >= minToolCount (default 5)
 *   2. outcome_score >= minScore (default 0.7)
 *   3. synthesized_skill IS NULL
 *   4. At least minSimilar similar trajectories exist
 *
 * Process:
 *   1. Find eligible trajectories
 *   2. Check for duplicates (tool chain fingerprint)
 *   3. Send to LLM for pattern extraction
 *   4. Generate SKILL.md
 *   5. Write to workspace skill layer
 */

import fs from "fs";
import path from "path";

// ── _deps for test injection ────────────────────────────

const _deps = { fs, path };

// ── Helpers ─────────────────────────────────────────────

/**
 * Extract unique tool names from a tool chain.
 * @param {Array<{tool:string}>} toolChain
 * @returns {string[]}
 */
export function extractToolNames(toolChain) {
  return [...new Set((toolChain || []).map((t) => t.tool))];
}

/**
 * Compute tool chain fingerprint (sorted tool name set).
 * Used for deduplication.
 * @param {Array<{tool:string}>} toolChain
 * @returns {string}
 */
export function toolChainFingerprint(toolChain) {
  return extractToolNames(toolChain).sort().join(",");
}

/**
 * Check if two fingerprints overlap by at least threshold.
 * Uses Jaccard index on the tool sets.
 * @param {string} fp1
 * @param {string} fp2
 * @param {number} [threshold=0.7]
 * @returns {boolean}
 */
export function fingerprintsOverlap(fp1, fp2, threshold = 0.7) {
  const set1 = new Set(fp1.split(",").filter(Boolean));
  const set2 = new Set(fp2.split(",").filter(Boolean));
  const intersection = [...set1].filter((t) => set2.has(t)).length;
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union >= threshold : false;
}

/**
 * Generate a kebab-case skill name from user intent.
 * @param {string} userIntent
 * @returns {string}
 */
export function generateSkillName(userIntent) {
  if (!userIntent) return "auto-learned-skill";
  return (
    userIntent
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join("-") || "auto-learned-skill"
  );
}

// ── LLM prompt template ─────────────────────────────────

/**
 * Build the LLM prompt for pattern extraction.
 * @param {object} trajectory
 * @returns {Array<{role:string, content:string}>}
 */
export function buildExtractionPrompt(trajectory) {
  const toolSteps = (trajectory.toolChain || [])
    .map(
      (t, i) =>
        `  ${i + 1}. ${t.tool}(${JSON.stringify(t.args || {}).slice(0, 200)}) → ${t.status} (${t.durationMs || 0}ms)`,
    )
    .join("\n");

  return [
    {
      role: "system",
      content: `You are a skill extraction expert. Analyze execution trajectories and extract reusable workflow patterns.
Output ONLY valid JSON with these fields:
{
  "name": "kebab-case-name",
  "description": "One-line description",
  "procedure": ["Step 1", "Step 2", ...],
  "pitfalls": ["Pitfall 1: description", ...],
  "verification": "How to confirm success",
  "tools": ["tool_name_1", "tool_name_2"]
}
If the trajectory is too specific or not reusable, respond with: {"not_applicable": true}`,
    },
    {
      role: "user",
      content: `## Execution Trajectory
User intent: ${trajectory.userIntent || "unknown"}
Tool chain:
${toolSteps}
Final response: ${(trajectory.finalResponse || "").slice(0, 500)}`,
    },
  ];
}

/**
 * Generate SKILL.md content from extracted pattern.
 * @param {object} pattern — { name, description, procedure, pitfalls, verification, tools }
 * @param {string} trajectoryId
 * @param {number} [confidence=0.7]
 * @returns {string}
 */
export function generateSkillMd(pattern, trajectoryId, confidence = 0.7) {
  const tools = (pattern.tools || []).join(", ");
  const procedure = (pattern.procedure || [])
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");
  const pitfalls = (pattern.pitfalls || []).map((p) => `- ${p}`).join("\n");

  return `---
name: ${pattern.name}
description: ${pattern.description || "Auto-learned skill"}
version: 1.0.0
category: auto-learned
tags: [auto-synthesized]
tools: [${tools}]
---

## Procedure
${procedure || "1. Follow the extracted workflow"}

## Pitfalls
${pitfalls || "- None identified yet"}

## Verification
${pattern.verification || "Verify the task completed successfully"}

## Metadata
- Source: trajectory
- Trajectory ID: ${trajectoryId}
- Confidence: ${confidence}
- Created by: learning-loop
`;
}

// ── SkillSynthesizer class ──────────────────────────────

export class SkillSynthesizer {
  /**
   * @param {import("better-sqlite3").Database} db
   * @param {function} llmChat — async (messages) => string (LLM response)
   * @param {import("./trajectory-store.js").TrajectoryStore} trajectoryStore
   * @param {{minToolCount?:number, minScore?:number, minSimilar?:number, outputDir?:string}} [config]
   */
  constructor(db, llmChat, trajectoryStore, config = {}) {
    this.db = db;
    this.llmChat = llmChat;
    this.trajectoryStore = trajectoryStore;
    this.minToolCount = config.minToolCount ?? 5;
    this.minScore = config.minScore ?? 0.7;
    this.minSimilar = config.minSimilar ?? 2;
    this.outputDir = config.outputDir || null;
  }

  /**
   * Scan for eligible trajectories and synthesize skills.
   * @returns {Promise<{created: string[], skipped: string[]}>}
   */
  async synthesize() {
    const candidates = this.trajectoryStore.findComplexUnprocessed({
      minToolCount: this.minToolCount,
      minScore: this.minScore,
      limit: 10,
    });

    const created = [];
    const skipped = [];

    for (const traj of candidates) {
      try {
        // Check similarity count
        const toolNames = extractToolNames(traj.toolChain);
        const similar = this.trajectoryStore.findSimilar(toolNames, {
          minSimilarity: 0.5,
          excludeId: traj.id,
        });

        if (similar.length < this.minSimilar) {
          skipped.push(
            `${traj.id}: insufficient similar trajectories (${similar.length}/${this.minSimilar})`,
          );
          continue;
        }

        // Check dedup against existing synthesized skills
        const fp = toolChainFingerprint(traj.toolChain);
        if (this._isDuplicate(fp)) {
          skipped.push(`${traj.id}: duplicate fingerprint`);
          continue;
        }

        // Extract pattern via LLM
        const pattern = await this._extractPattern(traj);
        if (!pattern || pattern.not_applicable) {
          skipped.push(`${traj.id}: LLM deemed not applicable`);
          continue;
        }

        // Generate and persist
        const skillName = pattern.name || generateSkillName(traj.userIntent);
        const content = generateSkillMd(
          pattern,
          traj.id,
          traj.outcomeScore || 0.7,
        );

        if (this.outputDir) {
          await this._persistSkill(skillName, content);
        }

        // Mark trajectory as synthesized
        this.trajectoryStore.markSynthesized(traj.id, skillName);
        created.push(skillName);
      } catch (err) {
        skipped.push(`${traj.id}: error - ${err.message}`);
      }
    }

    return { created, skipped };
  }

  /**
   * Extract pattern from a single trajectory via LLM.
   * @param {object} trajectory
   * @returns {Promise<object|null>}
   */
  async _extractPattern(trajectory) {
    if (!this.llmChat) return null;

    const messages = buildExtractionPrompt(trajectory);
    const response = await this.llmChat(messages);

    try {
      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  /**
   * Check if a fingerprint matches any already-synthesized trajectory.
   * @param {string} fingerprint
   * @returns {boolean}
   */
  _isDuplicate(fingerprint) {
    // Check against already-synthesized trajectories
    const synthesized = this.db
      .prepare(
        "SELECT tool_chain FROM learning_trajectories WHERE synthesized_skill IS NOT NULL",
      )
      .all();

    for (const row of synthesized) {
      let chain;
      try {
        chain = JSON.parse(row.tool_chain);
      } catch {
        continue;
      }
      const existingFp = toolChainFingerprint(chain);
      if (fingerprintsOverlap(fingerprint, existingFp)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Write SKILL.md to the output directory.
   * @param {string} skillName
   * @param {string} content
   * @returns {Promise<{skillDir:string, skillFile:string}>}
   */
  async _persistSkill(skillName, content) {
    const skillDir = _deps.path.join(this.outputDir, skillName);
    const skillFile = _deps.path.join(skillDir, "SKILL.md");

    await _deps.fs.promises.mkdir(skillDir, { recursive: true });
    await _deps.fs.promises.writeFile(skillFile, content, "utf-8");

    return { skillDir, skillFile };
  }
}

export { _deps };
