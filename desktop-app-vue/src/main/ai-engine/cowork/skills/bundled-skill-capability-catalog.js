/**
 * Reviewed execution identities for incrementally migrated bundled Skills.
 *
 * A catalog entry is a checked-in attestation that the named handler was
 * manually audited for exactly the listed capabilities. Handler files are
 * checked out as LF by repository attributes, so the raw-byte SHA-256 is the
 * same exact reviewed source identity on every supported platform.
 */

const BUNDLED_SKILL_CAPABILITY_CATALOG = Object.freeze({
  brainstorming: Object.freeze({
    skillId: "brainstorming",
    handlerRelativePath: "handler.js",
    sourceSha256:
      "bc0fd3fcb95d86fe8e7831b8bf87219463ecef49678b6f715f0f8abf5ce57e46",
    executionCapabilities: Object.freeze(["data:result", "data:task"]),
  }),
  "color-picker": Object.freeze({
    skillId: "color-picker",
    handlerRelativePath: "handler.js",
    sourceSha256:
      "73d0628791263086486809ab07bf6781ffe2e55d6650c285e30f714e28e013cb",
    executionCapabilities: Object.freeze([
      "data:result",
      "data:task",
      "runtime:random",
    ]),
  }),
  humanizer: Object.freeze({
    skillId: "humanizer",
    handlerRelativePath: "handler.js",
    sourceSha256:
      "68a0915b0890e1efbf23f8dee2d66f5820136757e90da5709fa134a481c18982",
    executionCapabilities: Object.freeze(["data:result", "data:task"]),
  }),
  "terraform-iac": Object.freeze({
    skillId: "terraform-iac",
    handlerRelativePath: "handler.js",
    sourceSha256:
      "8eecb0fded379bf05914b6597427ef05f53d7e9f5c6823af93aca97ea24b875f",
    executionCapabilities: Object.freeze(["data:result", "data:task"]),
  }),
  "text-transformer": Object.freeze({
    skillId: "text-transformer",
    handlerRelativePath: "handler.js",
    sourceSha256:
      "e9cce922d6a0c5d7216133f4b4c220fe9a216adfe16b5805d8ff4c70fd19992f",
    executionCapabilities: Object.freeze([
      "data:result",
      "data:task",
      "runtime:crypto",
    ]),
  }),
  ultrathink: Object.freeze({
    skillId: "ultrathink",
    handlerRelativePath: "handler.js",
    sourceSha256:
      "3792d1fd1519e0cbf0a527165a0d6b10413c1532c0a09559fb6f6681f566ee49",
    executionCapabilities: Object.freeze(["data:result", "data:task"]),
  }),
});

module.exports = { BUNDLED_SKILL_CAPABILITY_CATALOG };
