/**
 * SkillImprover — Iteratively improves auto-synthesized SKILL.md files
 * based on execution feedback and better trajectories.
 *
 * Three improvement triggers:
 *   1. repairFromError — skill execution failed, patch the procedure
 *   2. updateFromCorrection — user corrected the agent, learn the delta
 *   3. improveFromBetterTrajectory — a higher-scoring trajectory for
 *      the same tool pattern was found, merge improvements
 *
 * All changes are logged to skill_improvement_log for auditability.
 */

import fs from "fs";
import path from "path";

// ── _deps for test injection ────────────────────────────
const _deps = { fs, path };

// ── Helpers ─────────────────────────────────────────────

/**
 * Bump a semver-like version string (e.g. "1.0.0" → "1.1.0").
 * Bumps the minor version.
 * @param {string} version
 * @returns {string}
 */
export function bumpVersion(version) {
  if (!version) return "1.1.0";
  const parts = version.split(".");
  if (parts.length < 3) return "1.1.0";
  const major = parseInt(parts[0], 10) || 1;
  const minor = parseInt(parts[1], 10) || 0;
  return `${major}.${minor + 1}.0`;
}

/**
 * Parse simple YAML frontmatter from SKILL.md content.
 * Returns { meta: {}, body: string }.
 * @param {string} content
 * @returns {{ meta: Record<string, string>, body: string }}
 */
export function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

/**
 * Rebuild SKILL.md from meta + body.
 * @param {Record<string, string>} meta
 * @param {string} body
 * @returns {string}
 */
export function rebuildSkillMd(meta, body) {
  const lines = Object.entries(meta).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

// ── LLM prompt builders ────────────────────────────────

/**
 * Build LLM prompt for error-based repair.
 * @param {string} skillContent — current SKILL.md
 * @param {object} errorContext — { error, toolChain, userIntent }
 * @returns {Array<{role:string, content:string}>}
 */
export function buildRepairPrompt(skillContent, errorContext) {
  return [
    {
      role: "system",
      content: `You are a skill improvement expert. A skill failed during execution.
Analyze the error and suggest fixes to the skill's procedure.
Output ONLY valid JSON:
{
  "diagnosis": "What went wrong",
  "fixedProcedure": ["Step 1", "Step 2", ...],
  "newPitfalls": ["Pitfall description", ...],
  "confidence": 0.0-1.0
}
If the skill cannot be improved from this error, respond with: {"not_applicable": true}`,
    },
    {
      role: "user",
      content: `## Current Skill
${skillContent.slice(0, 1500)}

## Error Context
Error: ${errorContext.error || "unknown"}
User intent: ${errorContext.userIntent || "unknown"}
Tool chain: ${JSON.stringify(errorContext.toolChain || []).slice(0, 500)}`,
    },
  ];
}

/**
 * Build LLM prompt for correction-based update.
 * @param {string} skillContent
 * @param {object} correctionContext — { userMessage, previousToolChain, correctedToolChain }
 * @returns {Array<{role:string, content:string}>}
 */
export function buildCorrectionPrompt(skillContent, correctionContext) {
  return [
    {
      role: "system",
      content: `You are a skill improvement expert. The user corrected the agent's behavior.
Compare the original and corrected execution to improve the skill.
Output ONLY valid JSON:
{
  "whatChanged": "Description of the correction",
  "updatedProcedure": ["Step 1", "Step 2", ...],
  "newPitfalls": ["Pitfall description", ...],
  "confidence": 0.0-1.0
}
If the correction is too specific to generalize, respond with: {"not_applicable": true}`,
    },
    {
      role: "user",
      content: `## Current Skill
${skillContent.slice(0, 1500)}

## Correction
User said: ${correctionContext.userMessage || ""}
Original tools: ${JSON.stringify(correctionContext.previousToolChain || []).slice(0, 300)}
Corrected tools: ${JSON.stringify(correctionContext.correctedToolChain || []).slice(0, 300)}`,
    },
  ];
}

/**
 * Build LLM prompt for improvement from a better trajectory.
 * @param {string} skillContent
 * @param {object} betterTrajectory
 * @returns {Array<{role:string, content:string}>}
 */
export function buildImprovementPrompt(skillContent, betterTrajectory) {
  const toolSteps = (betterTrajectory.toolChain || [])
    .map(
      (t, i) =>
        `  ${i + 1}. ${t.tool}(${JSON.stringify(t.args || {}).slice(0, 150)}) → ${t.status}`,
    )
    .join("\n");

  return [
    {
      role: "system",
      content: `You are a skill improvement expert. A better execution trajectory was found for a similar task.
Merge improvements into the existing skill.
Output ONLY valid JSON:
{
  "improvements": "Summary of what's better",
  "mergedProcedure": ["Step 1", "Step 2", ...],
  "mergedPitfalls": ["Pitfall description", ...],
  "updatedVerification": "Updated verification step",
  "confidence": 0.0-1.0
}
If no meaningful improvements can be extracted, respond with: {"not_applicable": true}`,
    },
    {
      role: "user",
      content: `## Current Skill
${skillContent.slice(0, 1500)}

## Better Trajectory (score: ${betterTrajectory.outcomeScore || "?"})
Intent: ${betterTrajectory.userIntent || "unknown"}
Tool chain:
${toolSteps}`,
    },
  ];
}

// ── SkillImprover class ────────────────────────────────

export class SkillImprover {
  /**
   * @param {import("better-sqlite3").Database} db
   * @param {function} llmChat — async (messages) => string
   * @param {import("./trajectory-store.js").TrajectoryStore} trajectoryStore
   * @param {{skillsDir?:string}} [config]
   */
  constructor(db, llmChat, trajectoryStore, config = {}) {
    this.db = db;
    this.llmChat = llmChat;
    this.trajectoryStore = trajectoryStore;
    this.skillsDir = config.skillsDir || null;
  }

  /**
   * Repair a skill after an execution error.
   * @param {string} skillName
   * @param {object} errorContext — { error, toolChain, userIntent }
   * @returns {Promise<{improved:boolean, reason:string}>}
   */
  async repairFromError(skillName, errorContext) {
    const skillContent = await this._readSkill(skillName);
    if (!skillContent) {
      return { improved: false, reason: "skill not found" };
    }

    const suggestion = await this._callLLM(
      buildRepairPrompt(skillContent, errorContext),
    );
    if (!suggestion || suggestion.not_applicable) {
      return { improved: false, reason: "LLM deemed not applicable" };
    }
    if ((suggestion.confidence || 0) < 0.4) {
      return { improved: false, reason: "low confidence" };
    }

    const { meta, body } = parseSkillFrontmatter(skillContent);
    const newBody = this._applyProcedurePatch(body, suggestion);
    meta.version = bumpVersion(meta.version);

    const newContent = rebuildSkillMd(meta, newBody);
    await this._writeSkill(skillName, newContent);
    this._logImprovement(skillName, "error_repair", suggestion.diagnosis || "");

    return { improved: true, reason: suggestion.diagnosis || "repaired" };
  }

  /**
   * Update a skill based on user correction.
   * @param {string} skillName
   * @param {object} correctionContext — { userMessage, previousToolChain, correctedToolChain }
   * @returns {Promise<{improved:boolean, reason:string}>}
   */
  async updateFromCorrection(skillName, correctionContext) {
    const skillContent = await this._readSkill(skillName);
    if (!skillContent) {
      return { improved: false, reason: "skill not found" };
    }

    const suggestion = await this._callLLM(
      buildCorrectionPrompt(skillContent, correctionContext),
    );
    if (!suggestion || suggestion.not_applicable) {
      return { improved: false, reason: "LLM deemed not applicable" };
    }
    if ((suggestion.confidence || 0) < 0.4) {
      return { improved: false, reason: "low confidence" };
    }

    const { meta, body } = parseSkillFrontmatter(skillContent);
    const newBody = this._applyCorrectionPatch(body, suggestion);
    meta.version = bumpVersion(meta.version);

    const newContent = rebuildSkillMd(meta, newBody);
    await this._writeSkill(skillName, newContent);
    this._logImprovement(
      skillName,
      "user_correction",
      suggestion.whatChanged || "",
    );

    return { improved: true, reason: suggestion.whatChanged || "corrected" };
  }

  /**
   * Improve a skill from a higher-scoring trajectory.
   * @param {string} skillName
   * @param {object} betterTrajectory — hydrated trajectory object
   * @returns {Promise<{improved:boolean, reason:string}>}
   */
  async improveFromBetterTrajectory(skillName, betterTrajectory) {
    const skillContent = await this._readSkill(skillName);
    if (!skillContent) {
      return { improved: false, reason: "skill not found" };
    }

    const suggestion = await this._callLLM(
      buildImprovementPrompt(skillContent, betterTrajectory),
    );
    if (!suggestion || suggestion.not_applicable) {
      return { improved: false, reason: "LLM deemed not applicable" };
    }
    if ((suggestion.confidence || 0) < 0.4) {
      return { improved: false, reason: "low confidence" };
    }

    const { meta, body } = parseSkillFrontmatter(skillContent);
    const newBody = this._applyImprovementPatch(body, suggestion);
    meta.version = bumpVersion(meta.version);

    const newContent = rebuildSkillMd(meta, newBody);
    await this._writeSkill(skillName, newContent);
    this._logImprovement(
      skillName,
      "better_trajectory",
      suggestion.improvements || "",
    );

    return { improved: true, reason: suggestion.improvements || "improved" };
  }

  /**
   * Scan for skills that can be improved from recent high-score trajectories.
   * @returns {Promise<{improved: string[], skipped: string[]}>}
   */
  async scanForImprovements() {
    const improved = [];
    const skipped = [];

    // Find synthesized trajectories that have higher-scoring siblings
    const synthesized = this.db
      .prepare(
        `SELECT DISTINCT synthesized_skill, tool_chain, outcome_score
         FROM learning_trajectories
         WHERE synthesized_skill IS NOT NULL
         ORDER BY outcome_score ASC
         LIMIT 20`,
      )
      .all();

    for (const row of synthesized) {
      try {
        let chain;
        try {
          chain = JSON.parse(row.tool_chain);
        } catch {
          continue;
        }

        const toolNames = [...new Set(chain.map((t) => t.tool))];
        const betterOnes = this.trajectoryStore.findSimilar(toolNames, {
          minSimilarity: 0.6,
        });

        // Find a trajectory with significantly higher score
        const better = betterOnes.find(
          (t) =>
            t.outcomeScore != null &&
            t.outcomeScore > (row.outcome_score || 0) + 0.15,
        );

        if (better) {
          const result = await this.improveFromBetterTrajectory(
            row.synthesized_skill,
            better,
          );
          if (result.improved) {
            improved.push(row.synthesized_skill);
          } else {
            skipped.push(`${row.synthesized_skill}: ${result.reason}`);
          }
        }
      } catch (err) {
        skipped.push(
          `${row.synthesized_skill || "unknown"}: error - ${err.message}`,
        );
      }
    }

    return { improved, skipped };
  }

  // ── Internal ────────────────────────────────────────

  /**
   * Call LLM and parse JSON response.
   * @param {Array<{role:string, content:string}>} messages
   * @returns {Promise<object|null>}
   */
  async _callLLM(messages) {
    if (!this.llmChat) return null;
    try {
      const response = await this.llmChat(messages);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  /**
   * Read a skill file from disk.
   * @param {string} skillName
   * @returns {Promise<string|null>}
   */
  async _readSkill(skillName) {
    if (!this.skillsDir) return null;
    const skillFile = _deps.path.join(this.skillsDir, skillName, "SKILL.md");
    try {
      return await _deps.fs.promises.readFile(skillFile, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Write updated skill content to disk.
   * @param {string} skillName
   * @param {string} content
   */
  async _writeSkill(skillName, content) {
    if (!this.skillsDir) return;
    const skillDir = _deps.path.join(this.skillsDir, skillName);
    const skillFile = _deps.path.join(skillDir, "SKILL.md");
    await _deps.fs.promises.mkdir(skillDir, { recursive: true });
    await _deps.fs.promises.writeFile(skillFile, content, "utf-8");
  }

  /**
   * Log an improvement to skill_improvement_log table.
   * @param {string} skillName
   * @param {string} triggerType
   * @param {string} detail
   */
  _logImprovement(skillName, triggerType, detail) {
    try {
      this.db
        .prepare(
          `INSERT INTO skill_improvement_log (skill_name, trigger_type, detail)
           VALUES (?, ?, ?)`,
        )
        .run(skillName, triggerType, (detail || "").slice(0, 500));
    } catch {
      // Non-critical, don't break the flow
    }
  }

  /**
   * Apply repair patch to skill body (replace Procedure + append Pitfalls).
   * @param {string} body
   * @param {object} suggestion
   * @returns {string}
   */
  _applyProcedurePatch(body, suggestion) {
    let result = body;

    if (suggestion.fixedProcedure && suggestion.fixedProcedure.length > 0) {
      const newProcedure = suggestion.fixedProcedure
        .map((step, i) => `${i + 1}. ${step}`)
        .join("\n");
      result = result.replace(
        /## Procedure\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Procedure\n${newProcedure}`,
      );
    }

    if (suggestion.newPitfalls && suggestion.newPitfalls.length > 0) {
      const pitfallLines = suggestion.newPitfalls
        .map((p) => `- ${p}`)
        .join("\n");
      result = result.replace(
        /## Pitfalls\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Pitfalls\n${pitfallLines}`,
      );
    }

    return result;
  }

  /**
   * Apply correction patch to skill body.
   * @param {string} body
   * @param {object} suggestion
   * @returns {string}
   */
  _applyCorrectionPatch(body, suggestion) {
    let result = body;

    if (
      suggestion.updatedProcedure &&
      suggestion.updatedProcedure.length > 0
    ) {
      const newProcedure = suggestion.updatedProcedure
        .map((step, i) => `${i + 1}. ${step}`)
        .join("\n");
      result = result.replace(
        /## Procedure\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Procedure\n${newProcedure}`,
      );
    }

    if (suggestion.newPitfalls && suggestion.newPitfalls.length > 0) {
      const pitfallLines = suggestion.newPitfalls
        .map((p) => `- ${p}`)
        .join("\n");
      result = result.replace(
        /## Pitfalls\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Pitfalls\n${pitfallLines}`,
      );
    }

    return result;
  }

  /**
   * Apply improvement patch to skill body.
   * @param {string} body
   * @param {object} suggestion
   * @returns {string}
   */
  _applyImprovementPatch(body, suggestion) {
    let result = body;

    if (suggestion.mergedProcedure && suggestion.mergedProcedure.length > 0) {
      const newProcedure = suggestion.mergedProcedure
        .map((step, i) => `${i + 1}. ${step}`)
        .join("\n");
      result = result.replace(
        /## Procedure\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Procedure\n${newProcedure}`,
      );
    }

    if (suggestion.mergedPitfalls && suggestion.mergedPitfalls.length > 0) {
      const pitfallLines = suggestion.mergedPitfalls
        .map((p) => `- ${p}`)
        .join("\n");
      result = result.replace(
        /## Pitfalls\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Pitfalls\n${pitfallLines}`,
      );
    }

    if (suggestion.updatedVerification) {
      result = result.replace(
        /## Verification\n[\s\S]*?(?=\n## |\n$|$)/,
        `## Verification\n${suggestion.updatedVerification}`,
      );
    }

    return result;
  }
}

export { _deps };
