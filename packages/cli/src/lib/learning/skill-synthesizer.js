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
 *   4. Generate and evaluate a candidate SKILL.md
 *   5. Persist the accepted candidate to an isolated candidate registry
 */

import fs from "fs";
import { firstBalancedJson } from "../json-schema-output.js";
import path from "path";

// ── _deps for test injection ────────────────────────────

const _deps = { fs, path };

export const SYNTHESIS_UNAVAILABLE_CODE = "LEARNING_SYNTHESIS_UNAVAILABLE";

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

/**
 * Skill names become path segments in the candidate registry. Keep the
 * accepted grammar deliberately small so an LLM response cannot escape the
 * configured registry root.
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
   * @param {{minToolCount?:number, minScore?:number, minSimilar?:number, candidateOutputDir?:string, activeSkillsDirs?:string[], evaluateCandidate?:function}} [config]
   */
  constructor(db, llmChat, trajectoryStore, config = {}) {
    this.db = db;
    this.llmChat = llmChat;
    this.trajectoryStore = trajectoryStore;
    this.minToolCount = config.minToolCount ?? 5;
    this.minScore = config.minScore ?? 0.7;
    this.minSimilar = config.minSimilar ?? 2;
    this.candidateOutputDir = config.candidateOutputDir || null;
    const configuredActiveSkillsDirs = Array.isArray(config.activeSkillsDirs)
      ? config.activeSkillsDirs
      : [];
    this.activeSkillsDirs = configuredActiveSkillsDirs.filter(
      (root) => typeof root === "string" && root.trim().length > 0,
    );
    this.activeSkillsDirsInvalid =
      configuredActiveSkillsDirs.length !== this.activeSkillsDirs.length;
    this.evaluateCandidate =
      typeof config.evaluateCandidate === "function"
        ? config.evaluateCandidate
        : null;
  }

  /**
   * Report whether this instance can truthfully create persisted candidates.
   * No trajectory is queried or mutated while the synthesizer is unavailable.
   * @returns {{available:boolean, missingDependencies:string[], blockers:string[]}}
   */
  getAvailability() {
    const missingDependencies = [];
    const blockers = [];
    if (typeof this.llmChat !== "function") missingDependencies.push("llm");
    if (!this.candidateOutputDir) {
      missingDependencies.push("candidate-output-registry");
    }
    if (typeof this.evaluateCandidate !== "function") {
      missingDependencies.push("candidate-evaluator");
    }
    if (this.activeSkillsDirs.length === 0) {
      missingDependencies.push("active-skill-registry-roots");
    }
    if (this.activeSkillsDirsInvalid) {
      blockers.push("active-skill-registry-roots-invalid");
    }
    if (
      this.candidateOutputDir &&
      this.activeSkillsDirs.some((activeRoot) =>
        rootsOverlap(activeRoot, this.candidateOutputDir),
      )
    ) {
      blockers.push("candidate-output-overlaps-active-skill-tree");
    }
    return {
      available: missingDependencies.length === 0 && blockers.length === 0,
      missingDependencies,
      blockers,
    };
  }

  /**
   * Scan for eligible trajectories and synthesize skills.
   * @returns {Promise<{status:string, created: string[], skipped: string[], errors?:string[], code?:string, reason?:string, missingDependencies?:string[], blockers?:string[]}>}
   */
  async synthesize() {
    const availability = this.getAvailability();
    if (!availability.available) {
      const issues = [
        ...availability.missingDependencies.map((item) => `missing ${item}`),
        ...availability.blockers,
      ];
      const reason = `Synthesis unavailable: ${issues.join(", ")}`;
      return {
        status: "unavailable",
        code: SYNTHESIS_UNAVAILABLE_CODE,
        reason,
        missingDependencies: availability.missingDependencies,
        blockers: availability.blockers,
        created: [],
        skipped: [],
      };
    }

    const candidates = this.trajectoryStore.findComplexUnprocessed({
      minToolCount: this.minToolCount,
      minScore: this.minScore,
      limit: 10,
    });

    const created = [];
    const skipped = [];
    const errors = [];

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
        if (!isSafeSkillName(skillName)) {
          skipped.push(`${traj.id}: invalid candidate skill name`);
          continue;
        }
        const content = generateSkillMd(
          pattern,
          traj.id,
          traj.outcomeScore || 0.7,
        );

        const evaluation = await this.evaluateCandidate({
          skillName,
          content,
          pattern,
          trajectory: traj,
        });
        const accepted =
          evaluation === true ||
          (evaluation &&
            typeof evaluation === "object" &&
            evaluation.accepted === true);
        if (!accepted) {
          const evaluationReason =
            evaluation && typeof evaluation === "object"
              ? evaluation.reason
              : null;
          skipped.push(
            `${traj.id}: evaluator rejected candidate${evaluationReason ? ` - ${evaluationReason}` : ""}`,
          );
          continue;
        }

        await this._persistSkill(skillName, content);

        // Only durable, evaluated candidates count as synthesized.
        this.trajectoryStore.markSynthesized(traj.id, skillName);
        created.push(skillName);
      } catch (err) {
        const message = `${traj.id}: error - ${err.message}`;
        skipped.push(message);
        errors.push(message);
      }
    }

    return {
      status: errors.length > 0 ? "error" : "completed",
      created,
      skipped,
      errors,
    };
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
      const jsonText = firstBalancedJson(response, "{");
      if (!jsonText) return null;
      return JSON.parse(jsonText);
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
   * Write SKILL.md to the isolated candidate output registry.
   * @param {string} skillName
   * @param {string} content
   * @returns {Promise<{skillDir:string, skillFile:string}>}
   */
  async _persistSkill(skillName, content) {
    if (!this.candidateOutputDir) {
      throw new Error("candidate output registry is unavailable");
    }
    if (!isSafeSkillName(skillName)) {
      throw new Error("invalid candidate skill name");
    }
    const availability = this.getAvailability();
    if (!availability.available) {
      throw new Error(
        `candidate output boundary unavailable: ${[
          ...availability.missingDependencies,
          ...availability.blockers,
        ].join(", ")}`,
      );
    }
    this._assertCandidateFilesystemSupport();
    const candidateRoot = await this._ensurePrivateDirectory(
      this.candidateOutputDir,
      { recursive: true },
    );
    await this._assertRealpathIsolation(candidateRoot);

    const skillNamespace = _deps.path.join(this.candidateOutputDir, skillName);
    const canonicalSkillNamespace =
      await this._ensurePrivateDirectory(skillNamespace);
    this._assertPathWithinCandidateRoot(candidateRoot, canonicalSkillNamespace);
    const skillDir = _deps.path.join(canonicalSkillNamespace, "1.0.0");
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
    const activeRoots = await Promise.all(
      this.activeSkillsDirs.map((root) => _deps.fs.promises.realpath(root)),
    );
    if (activeRoots.some((root) => rootsOverlap(root, candidateRoot))) {
      throw new Error(
        "candidate output resolves into an active skill tree; refusing write",
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
}

export { _deps };
