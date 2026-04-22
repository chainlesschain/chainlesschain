/**
 * Shared helpers for the "Governance V2" pattern used across 86+ surfaces
 * (iter16–iter28 V2 ports) in packages/cli/src/lib/*.js.
 *
 * Every gov-V2 module declares roughly the same scaffolding:
 *   - two Maps (profiles + jobs/sessions/etc.)
 *   - four numeric caps (maxActivePerOwner, maxPendingPerProfile,
 *     idleMs, stuckMs) with matching get/set pairs
 *   - a positive-integer validator
 *   - 4-state and 5-state transition tables + validators
 *   - a _resetStateXxxGovV2() that re-initialises everything
 *
 * The shapes vary only in names and defaults, so these helpers let new
 * (and migrated) modules replace ~50 lines of boilerplate with ~10.
 *
 * Migration guide: see GOV_V2_MIGRATION.md at repo root.
 *
 * CJS + ESM compat: re-exported via both styles so the existing mix of
 * module systems inside packages/cli/src/lib can consume it.
 */

/**
 * Validate that `n` is a finite positive integer. Throws with a label.
 */
function positiveInteger(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be positive integer`);
  }
  return v;
}

/**
 * Build a `checkTransition(from, to)` fn from a state-transition map.
 * Throws with a domain-specific message when the transition is invalid.
 *
 * @param {Map<string, Set<string>>} transitions
 * @param {string} label  e.g. "shgov profile"
 */
function createTransitionChecker(transitions, label) {
  return function checkTransition(from, to) {
    const allowed = transitions.get(from);
    if (!allowed || !allowed.has(to)) {
      throw new Error(`invalid ${label} transition ${from} → ${to}`);
    }
  };
}

/**
 * Build a suite of cap (limit) accessors wired to a single mutable state
 * object. Returns an object with `get<Name>V2()` / `set<Name>V2(n)` pairs
 * for every field in `defaults`. The set variants run `positiveInteger`
 * validation and apply the new value; reset() re-applies the defaults.
 *
 * @param {Object<string, number>} defaults map of capName → default value
 * @returns {{ caps, resetCaps, setters, getters }}
 */
function createCapRegistry(defaults) {
  const caps = { ...defaults };
  const setters = {};
  const getters = {};
  for (const [name, defaultValue] of Object.entries(defaults)) {
    setters[name] = (n) => {
      caps[name] = positiveInteger(n, name);
    };
    getters[name] = () => caps[name];
    // sanity: reject non-numeric defaults
    if (!Number.isFinite(defaultValue) || defaultValue <= 0) {
      throw new Error(
        `governance-v2-helpers: default for ${name} must be a positive number`,
      );
    }
  }
  function resetCaps() {
    for (const [name, defaultValue] of Object.entries(defaults)) {
      caps[name] = defaultValue;
    }
  }
  return { caps, resetCaps, setters, getters };
}

/**
 * Count entries in a Map whose values satisfy `predicate`.
 */
function countBy(map, predicate) {
  let c = 0;
  for (const v of map.values()) {
    if (predicate(v)) c++;
  }
  return c;
}

/**
 * Build a state-transition Map from a plain object
 *   { active: ["paused", "archived"], paused: ["active"] }
 */
function buildTransitionMap(table) {
  const m = new Map();
  for (const [from, tos] of Object.entries(table)) {
    m.set(from, new Set(tos));
  }
  return m;
}

module.exports = {
  positiveInteger,
  createTransitionChecker,
  createCapRegistry,
  countBy,
  buildTransitionMap,
};
