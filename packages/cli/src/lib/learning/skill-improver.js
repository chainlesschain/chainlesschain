/**
 * SkillImprover — Proposes candidate revisions for auto-synthesized SKILL.md
 * files based on execution feedback and better trajectories.
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
import { firstBalancedJson } from "../json-schema-output.js";
import path from "path";
import { assertSkillFileSize, resolveSkillLimits } from "../skill-budget.js";

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

/**
 * A skill name is used as a path segment in both the source and candidate
 * trees. Reject traversal and ambiguous path-like names before any I/O.
 * @param {string} skillName
 * @returns {boolean}
 */
export function isSafeSkillName(skillName) {
  return (
    typeof skillName === "string" &&
    /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,127}$/u.test(skillName) &&
    skillName !== "." &&
    skillName !== ".." &&
    !skillName.includes("..")
  );
}

function rootContains(parentRoot, childRoot) {
  if (!parentRoot || !childRoot) return false;
  const parent = path.resolve(parentRoot);
  const child = path.resolve(childRoot);
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function rootsOverlap(firstRoot, secondRoot) {
  return (
    rootContains(firstRoot, secondRoot) || rootContains(secondRoot, firstRoot)
  );
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
   * @param {{skillsDir?:string, candidateOutputDir?:string, diffOnly?:boolean, limits?:object}} [config]
   */
  constructor(db, llmChat, trajectoryStore, config = {}) {
    this.db = db;
    this.llmChat = llmChat;
    this.trajectoryStore = trajectoryStore;
    this.skillsDir = config.skillsDir || null;
    this.candidateOutputDir = config.candidateOutputDir || null;
    this.diffOnly = config.diffOnly === true;
    this.skillLimits = resolveSkillLimits(config.limits);
  }

  /**
   * Return the fail-closed mutation boundary for this instance. `skillsDir` is
   * always read-only; proposals must use an isolated candidate root or
   * explicitly opt into diff-only output.
   * @returns {{available:boolean, reason?:string}}
   */
  getAvailability() {
    if (!this.skillsDir) {
      return { available: false, reason: "source skill registry unavailable" };
    }
    if (typeof this.llmChat !== "function") {
      return { available: false, reason: "LLM unavailable" };
    }
    if (this.diffOnly && this.candidateOutputDir) {
      return {
        available: false,
        reason: "configure either candidateOutputDir or diffOnly, not both",
      };
    }
    if (!this.diffOnly && !this.candidateOutputDir) {
      return {
        available: false,
        reason:
          "candidate output unavailable; configure candidateOutputDir or diffOnly",
      };
    }
    if (
      this.candidateOutputDir &&
      rootsOverlap(this.skillsDir, this.candidateOutputDir)
    ) {
      return {
        available: false,
        reason: "candidate output must be isolated from the active skill tree",
      };
    }
    return { available: true };
  }

  _unavailableResult() {
    const availability = this.getAvailability();
    return availability.available
      ? null
      : {
          improved: false,
          candidateCreated: false,
          status: "unavailable",
          reason: availability.reason,
        };
  }

  /**
   * Repair a skill after an execution error.
   * @param {string} skillName
   * @param {object} errorContext — { error, toolChain, userIntent }
   * @returns {Promise<{improved:boolean, reason:string}>}
   */
  async repairFromError(skillName, errorContext) {
    const unavailable = this._unavailableResult();
    if (unavailable) return unavailable;
    if (!isSafeSkillName(skillName)) {
      return {
        improved: false,
        candidateCreated: false,
        status: "error",
        reason: "invalid skill name",
      };
    }
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
    return this._finalizeCandidate({
      skillName,
      content: newContent,
      version: meta.version,
      triggerType: "error_repair",
      detail: suggestion.diagnosis || "",
      reason: suggestion.diagnosis || "repair candidate generated",
    });
  }

  /**
   * Update a skill based on user correction.
   * @param {string} skillName
   * @param {object} correctionContext — { userMessage, previousToolChain, correctedToolChain }
   * @returns {Promise<{improved:boolean, reason:string}>}
   */
  async updateFromCorrection(skillName, correctionContext) {
    const unavailable = this._unavailableResult();
    if (unavailable) return unavailable;
    if (!isSafeSkillName(skillName)) {
      return {
        improved: false,
        candidateCreated: false,
        status: "error",
        reason: "invalid skill name",
      };
    }
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
    return this._finalizeCandidate({
      skillName,
      content: newContent,
      version: meta.version,
      triggerType: "user_correction",
      detail: suggestion.whatChanged || "",
      reason: suggestion.whatChanged || "correction candidate generated",
    });
  }

  /**
   * Improve a skill from a higher-scoring trajectory.
   * @param {string} skillName
   * @param {object} betterTrajectory — hydrated trajectory object
   * @returns {Promise<{improved:boolean, reason:string}>}
   */
  async improveFromBetterTrajectory(skillName, betterTrajectory) {
    const unavailable = this._unavailableResult();
    if (unavailable) return unavailable;
    if (!isSafeSkillName(skillName)) {
      return {
        improved: false,
        candidateCreated: false,
        status: "error",
        reason: "invalid skill name",
      };
    }
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
    return this._finalizeCandidate({
      skillName,
      content: newContent,
      version: meta.version,
      triggerType: "better_trajectory",
      detail: suggestion.improvements || "",
      reason: suggestion.improvements || "improvement candidate generated",
    });
  }

  /**
   * Scan for skills that can be improved from recent high-score trajectories.
   * @returns {Promise<{status:string, improved: string[], candidates: object[], skipped: string[], reason?:string}>}
   */
  async scanForImprovements() {
    const unavailable = this._unavailableResult();
    if (unavailable) {
      return {
        status: unavailable.status,
        improved: [],
        candidates: [],
        skipped: [],
        reason: unavailable.reason,
      };
    }

    const improved = [];
    const candidates = [];
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
          if (result.candidateCreated || result.status === "diff-only") {
            candidates.push({
              skillName: row.synthesized_skill,
              status: result.status,
              candidatePath: result.candidatePath || null,
            });
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

    return { status: "completed", improved, candidates, skipped };
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
      const jsonText = firstBalancedJson(response, "{");
      if (!jsonText) return null;
      return JSON.parse(jsonText);
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
    if (!this.skillsDir || !isSafeSkillName(skillName)) return null;
    const skillFile = _deps.path.join(this.skillsDir, skillName, "SKILL.md");
    try {
      if (typeof _deps.fs.promises.lstat === "function") {
        const stat = await _deps.fs.promises.lstat(skillFile);
        if (stat.isSymbolicLink() || !stat.isFile()) return null;
        assertSkillFileSize("SKILL.md", stat.size, this.skillLimits);
      }
      const content = await _deps.fs.promises.readFile(skillFile, "utf-8");
      if (typeof content !== "string") return null;
      assertSkillFileSize(
        "SKILL.md",
        Buffer.byteLength(content, "utf8"),
        this.skillLimits,
      );
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Persist or return a candidate without mutating the source skill tree.
   * The audit write is required: callers never receive a successful candidate
   * result when persistence or logging fails.
   * @param {{skillName:string, content:string, version:string, triggerType:string, detail:string, reason:string}} candidate
   * @returns {Promise<object>}
   */
  async _finalizeCandidate(candidate) {
    if (this.diffOnly) {
      this._logImprovement(
        candidate.skillName,
        candidate.triggerType,
        candidate.detail,
      );
      return {
        improved: false,
        candidateCreated: false,
        candidateGenerated: true,
        status: "diff-only",
        reason: candidate.reason,
        candidate: {
          skillName: candidate.skillName,
          version: candidate.version,
          content: candidate.content,
        },
      };
    }

    const persisted = await this._writeCandidate(
      candidate.skillName,
      candidate.version,
      candidate.content,
    );
    this._logImprovement(
      candidate.skillName,
      candidate.triggerType,
      candidate.detail,
    );
    return {
      improved: false,
      candidateCreated: true,
      candidateGenerated: true,
      status: "candidate",
      reason: candidate.reason,
      candidatePath: persisted.skillFile,
      candidate: {
        skillName: candidate.skillName,
        version: candidate.version,
      },
    };
  }

  /**
   * Write a versioned candidate to the isolated candidate registry.
   * @param {string} skillName
   * @param {string} version
   * @param {string} content
   * @returns {Promise<{skillDir:string, skillFile:string}>}
   */
  async _writeCandidate(skillName, version, content) {
    const availability = this.getAvailability();
    if (!availability.available || this.diffOnly) {
      throw new Error(
        availability.reason || "candidate persistence unavailable",
      );
    }
    if (!isSafeSkillName(skillName) || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error("invalid candidate identity");
    }
    assertSkillFileSize(
      "SKILL.md",
      Buffer.byteLength(String(content), "utf8"),
      this.skillLimits,
    );
    this._assertCandidateFilesystemSupport();
    const candidateRoot = await this._ensurePrivateDirectory(
      this.candidateOutputDir,
      { recursive: true },
    );
    await this._assertRealpathIsolation(candidateRoot);

    const skillNamespacePath = _deps.path.join(
      this.candidateOutputDir,
      skillName,
    );
    const skillNamespace =
      await this._ensurePrivateDirectory(skillNamespacePath);
    this._assertPathWithinCandidateRoot(candidateRoot, skillNamespace);

    const skillDir = _deps.path.join(skillNamespace, version);
    const canonicalSkillDir = await this._ensurePrivateDirectory(skillDir);
    this._assertPathWithinCandidateRoot(candidateRoot, canonicalSkillDir);

    const skillFile = _deps.path.join(canonicalSkillDir, "SKILL.md");
    await _deps.fs.promises.writeFile(skillFile, content, {
      encoding: "utf-8",
      flag: "wx",
    });
    return { skillDir: canonicalSkillDir, skillFile };
  }

  _assertCandidateFilesystemSupport() {
    if (
      typeof _deps.fs.promises.realpath !== "function" ||
      typeof _deps.fs.promises.lstat !== "function"
    ) {
      throw new Error(
        "candidate filesystem identity support unavailable; refusing write",
      );
    }
  }

  async _ensurePrivateDirectory(directory, options = {}) {
    let stat;
    try {
      stat = await _deps.fs.promises.lstat(directory);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await _deps.fs.promises.mkdir(directory, {
          recursive: options.recursive === true,
          mode: 0o700,
        });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      stat = await _deps.fs.promises.lstat(directory);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(
        `candidate directory is not a trusted directory: ${directory}`,
      );
    }
    return _deps.fs.promises.realpath(directory);
  }

  async _assertRealpathIsolation(candidateRoot) {
    const sourceRoot = await _deps.fs.promises.realpath(this.skillsDir);
    if (rootsOverlap(sourceRoot, candidateRoot)) {
      throw new Error(
        "candidate output resolves into the active skill tree; refusing write",
      );
    }
  }

  _assertPathWithinCandidateRoot(candidateRoot, candidatePath) {
    if (!rootContains(candidateRoot, candidatePath)) {
      throw new Error(
        "candidate parent resolves outside the candidate root; refusing write",
      );
    }
  }

  /**
   * Log an improvement to skill_improvement_log table.
   * @param {string} skillName
   * @param {string} triggerType
   * @param {string} detail
   */
  _logImprovement(skillName, triggerType, detail) {
    this.db
      .prepare(
        `INSERT INTO skill_improvement_log (skill_name, trigger_type, detail)
         VALUES (?, ?, ?)`,
      )
      .run(skillName, triggerType, (detail || "").slice(0, 500));
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

    if (suggestion.updatedProcedure && suggestion.updatedProcedure.length > 0) {
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
