/**
 * Phase 11 — internal analysis skills entry point.
 *
 * Each skill is a small focused class that the hub dispatches to via
 * `runAnalysisSkill(name, options)`. Skills work over the vault +
 * optional LLM and respect the same privacy gate as AnalysisEngine.
 */

"use strict";

const { AnalysisSkill } = require("./base");
const { SpendingSkill, SUPPORTED_DIMENSIONS: SPENDING_DIMENSIONS } = require("./spending");
const { RelationsSkill } = require("./relations");
const { FootprintSkill } = require("./footprint");
const { InterestsSkill } = require("./interests");
const { TimelineSkill } = require("./timeline");
const { OverviewSkill } = require("./overview");

const SKILL_REGISTRY = Object.freeze({
  "analysis.spending": SpendingSkill,
  "analysis.relations": RelationsSkill,
  "analysis.footprint": FootprintSkill,
  "analysis.interests": InterestsSkill,
  "analysis.timeline": TimelineSkill,
  "analysis.overview": OverviewSkill,
});

const SKILL_NAMES = Object.freeze(Object.keys(SKILL_REGISTRY));

/**
 * Run a single skill by name. Convenience over instantiating Skill
 * classes directly — the same {vault, llm} pair gets reused.
 *
 * @param {{vault, llm?}} deps
 * @param {string} skillName
 * @param {object} options
 */
async function runAnalysisSkill(deps, skillName, options = {}) {
  if (!deps || !deps.vault) throw new Error("runAnalysisSkill: deps.vault required");
  const Cls = SKILL_REGISTRY[skillName];
  if (!Cls) {
    throw new Error(`unknown analysis skill: ${skillName}. Known: ${SKILL_NAMES.join(", ")}`);
  }
  const skill = new Cls({ vault: deps.vault, llm: deps.llm });
  return await skill.run(options);
}

module.exports = {
  AnalysisSkill,
  SpendingSkill,
  RelationsSkill,
  FootprintSkill,
  InterestsSkill,
  TimelineSkill,
  OverviewSkill,
  SKILL_REGISTRY,
  SKILL_NAMES,
  ANALYSIS_SKILL_NAMES: SKILL_NAMES,
  SPENDING_DIMENSIONS,
  runAnalysisSkill,
};
