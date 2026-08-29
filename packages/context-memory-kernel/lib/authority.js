"use strict";

const { CONTEXT_ERROR_CODES } = require("./constants.js");
const { canonicalJson } = require("./canonical.js");
const {
  identifier,
  boundedInteger,
  objectValue,
  assertKnownFields,
  timestamp,
} = require("./contracts.js");
const { invalidArgument, kernelError } = require("./errors.js");

const AUTHORITY_MODES = Object.freeze(["legacy", "shadow", "canonical"]);
const CUTOVER_STAGES = Object.freeze([
  "inventory",
  "shadow",
  "internal_canary",
  "opt_in_canary",
  "canonical_default",
  "legacy_read_only",
  "retired",
]);
const STAGE_TRANSITIONS = Object.freeze({
  inventory: new Set(["shadow"]),
  shadow: new Set(["inventory", "internal_canary"]),
  internal_canary: new Set(["shadow", "opt_in_canary"]),
  opt_in_canary: new Set(["internal_canary", "canonical_default"]),
  canonical_default: new Set(["opt_in_canary", "legacy_read_only"]),
  legacy_read_only: new Set(["canonical_default", "retired"]),
  retired: new Set(),
});
const BINDING_FIELDS = new Set([
  "scopeKey",
  "surface",
  "mode",
  "stage",
  "writerId",
  "generation",
  "leaseExpiresAt",
]);

function normalizeAuthorityBinding(input) {
  const value = objectValue(input, "ContextMemoryAuthorityBinding");
  assertKnownFields(value, BINDING_FIELDS, "ContextMemoryAuthorityBinding");
  if (!AUTHORITY_MODES.includes(value.mode)) throw invalidArgument("authority mode is invalid", { mode: value.mode });
  if (!CUTOVER_STAGES.includes(value.stage)) throw invalidArgument("cutover stage is invalid", { stage: value.stage });
  if (["inventory", "shadow"].includes(value.stage) && value.mode !== "legacy") {
    throw invalidArgument(`${value.stage} stage must retain legacy mutation authority`);
  }
  if (["internal_canary", "opt_in_canary"].includes(value.stage) && !["legacy", "canonical"].includes(value.mode)) {
    throw invalidArgument(`${value.stage} stage requires an explicit legacy/canonical cohort decision`);
  }
  if (["canonical_default", "legacy_read_only", "retired"].includes(value.stage) && value.mode !== "canonical") {
    throw invalidArgument(`${value.stage} stage requires canonical authority`);
  }
  const binding = {
    scopeKey: identifier(value.scopeKey, "scopeKey"),
    surface: identifier(value.surface, "surface"),
    mode: value.mode,
    stage: value.stage,
    writerId: identifier(value.writerId, "writerId"),
    generation: boundedInteger(value.generation, "generation", { min: 1 }),
  };
  if (value.leaseExpiresAt !== undefined) {
    binding.leaseExpiresAt = timestamp(value.leaseExpiresAt, "leaseExpiresAt");
  }
  if (binding.mode === "canonical" && !binding.leaseExpiresAt) {
    throw invalidArgument("canonical authority requires an expiring writer lease");
  }
  return binding;
}

class ContextMemoryAuthorityRegistry {
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.bindings = new Map();
  }

  bind(input) {
    const next = normalizeAuthorityBinding(input);
    const previous = this.bindings.get(next.scopeKey);
    if (previous) {
      if (next.generation < previous.generation) throw invalidArgument("authority generation cannot move backwards");
      if (next.generation === previous.generation && canonicalJson(next) !== canonicalJson(previous)) {
        throw invalidArgument("authority binding cannot change without a new generation");
      }
      if (next.stage !== previous.stage && !STAGE_TRANSITIONS[previous.stage].has(next.stage)) {
        throw invalidArgument(`illegal cutover transition from ${previous.stage} to ${next.stage}`);
      }
    }
    this.bindings.set(next.scopeKey, next);
    return { ...next };
  }

  get(scopeKey) {
    const binding = this.bindings.get(scopeKey);
    return binding ? { ...binding } : null;
  }

  assertWriter({ scopeKey, surface, writerId, generation, mode }) {
    const current = this.bindings.get(scopeKey);
    if (!current) {
      throw kernelError(CONTEXT_ERROR_CODES.LEGACY_WRITER_FENCED, "no context/memory writer authority is registered", {
        scopeKey,
      });
    }
    const matches =
      current.surface === surface &&
      current.writerId === writerId &&
      current.generation === generation &&
      current.mode === mode;
    if (
      !matches ||
      mode !== "canonical"
    ) {
      throw kernelError(CONTEXT_ERROR_CODES.LEGACY_WRITER_FENCED, "context/memory writer is fenced", {
        scopeKey,
        requested: { surface, writerId, generation, mode },
        current,
      });
    }
    if (Date.parse(current.leaseExpiresAt) <= Number(this.clock())) {
      throw kernelError(CONTEXT_ERROR_CODES.LEGACY_WRITER_FENCED, "canonical writer lease expired", {
        scopeKey,
        current,
      });
    }
    return { ...current };
  }
}

module.exports = {
  AUTHORITY_MODES,
  CUTOVER_STAGES,
  STAGE_TRANSITIONS,
  normalizeAuthorityBinding,
  ContextMemoryAuthorityRegistry,
};
