/**
 * Reviewed execution identities for incrementally migrated bundled Skills.
 *
 * A catalog entry is a checked-in attestation that the named handler was
 * manually audited for exactly the listed capabilities. Handler files are
 * checked out as LF by repository attributes, so the raw-byte SHA-256 is the
 * same exact reviewed source identity on every supported platform.
 */

const BUNDLED_SKILL_CAPABILITY_CATALOG = Object.freeze({
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
});

module.exports = { BUNDLED_SKILL_CAPABILITY_CATALOG };
