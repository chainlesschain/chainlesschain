/** Declarative, validated keybindings for interactive prompt actions. */

export const REPL_KEYBINDING_ACTIONS = Object.freeze([
  "prompt.edit",
  "prompt.stash",
  "prompt.pop",
  "session.recap",
  "suggestions.toggle",
]);

export const DEFAULT_REPL_KEYBINDINGS = Object.freeze({
  "prompt.edit": Object.freeze(["ctrl+g"]),
  "prompt.stash": Object.freeze(["alt+s"]),
  "prompt.pop": Object.freeze(["alt+p"]),
  "session.recap": Object.freeze(["alt+r"]),
  "suggestions.toggle": Object.freeze(["alt+n"]),
});

const MODIFIER_ORDER = ["ctrl", "alt", "shift"];
const MODIFIER_ALIASES = new Map([
  ["control", "ctrl"],
  ["option", "alt"],
  // Node's terminal keypress API reports an escape-prefixed Alt/Option key as
  // `meta`; desktop Command/Windows keys are not reliably exposed to readline.
  ["meta", "alt"],
]);
const KEY_ALIASES = new Map([
  ["return", "enter"],
  ["esc", "escape"],
  ["spacebar", "space"],
]);
const SAFE_NAMED_KEYS = new Set([
  "backspace",
  "delete",
  "down",
  "end",
  "enter",
  "escape",
  "home",
  "insert",
  "left",
  "pageup",
  "pagedown",
  "right",
  "space",
  "tab",
  "up",
]);
const RESERVED_CHORDS = new Set([
  "ctrl+c",
  "ctrl+d",
  "ctrl+q",
  "ctrl+s",
  "ctrl+z",
  "enter",
  "escape",
  "shift+tab",
  "tab",
]);

export const REPL_KEYBINDINGS_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    REPL_KEYBINDING_ACTIONS.map((action) => [
      action,
      {
        oneOf: [
          { type: "string", minLength: 1 },
          {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
          },
          { type: "null" },
        ],
      },
    ]),
  ),
});

export function normalizeKeyChord(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) throw new Error("key chord is empty");
  const parts = raw.split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) throw new Error(`invalid key chord: ${raw}`);
  const modifiers = new Set();
  let key = null;
  for (const rawPart of parts) {
    const part = MODIFIER_ALIASES.get(rawPart) || rawPart;
    if (MODIFIER_ORDER.includes(part)) {
      if (modifiers.has(part)) throw new Error(`duplicate modifier: ${part}`);
      modifiers.add(part);
      continue;
    }
    if (key !== null) throw new Error(`key chord has multiple keys: ${raw}`);
    key = KEY_ALIASES.get(part) || part;
  }
  if (!key) throw new Error(`key chord has no key: ${raw}`);
  if (!/^[a-z0-9]$/.test(key) && !/^f(?:[1-9]|1[0-2])$/.test(key)) {
    if (!SAFE_NAMED_KEYS.has(key)) throw new Error(`unsupported key: ${key}`);
  }
  const chord = [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+");
  if (RESERVED_CHORDS.has(chord)) {
    throw new Error(`reserved terminal key chord: ${chord}`);
  }
  return chord;
}

function configuredKeybindings(settings = {}) {
  if (settings.cli?.keybindings != null) return settings.cli.keybindings;
  if (settings.keybindings != null) return settings.keybindings;
  if (
    settings &&
    typeof settings === "object" &&
    Object.keys(settings).some((key) => REPL_KEYBINDING_ACTIONS.includes(key))
  ) {
    return settings;
  }
  return {};
}

/**
 * Compile settings to a chord -> action map. An explicit null/[] disables the
 * default for that action. Invalid entries are reported and never installed.
 */
export function validateReplKeybindings(settings = {}, options = {}) {
  const configured = configuredKeybindings(settings);
  const errors = [];
  const actionBindings = {};
  const includeDefaults = options.includeDefaults !== false;

  if (
    !configured ||
    typeof configured !== "object" ||
    Array.isArray(configured)
  ) {
    return {
      valid: false,
      errors: ["keybindings must be an object"],
      bindings: new Map(),
      actionBindings,
    };
  }
  for (const key of Object.keys(configured)) {
    if (!REPL_KEYBINDING_ACTIONS.includes(key)) {
      errors.push(`unknown keybinding action: ${key}`);
    }
  }

  const chordOwners = new Map();
  for (const action of REPL_KEYBINDING_ACTIONS) {
    const hasOverride = Object.prototype.hasOwnProperty.call(
      configured,
      action,
    );
    const raw = hasOverride
      ? configured[action]
      : includeDefaults
        ? DEFAULT_REPL_KEYBINDINGS[action]
        : [];
    const values = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    actionBindings[action] = [];
    for (const value of values) {
      let chord;
      try {
        chord = normalizeKeyChord(value);
      } catch (error) {
        errors.push(`${action}: ${error.message}`);
        continue;
      }
      const owner = chordOwners.get(chord);
      if (owner && owner !== action) {
        errors.push(
          `key chord ${chord} is assigned to both ${owner} and ${action}`,
        );
        continue;
      }
      chordOwners.set(chord, action);
      if (!actionBindings[action].includes(chord)) {
        actionBindings[action].push(chord);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    bindings: new Map(
      [...chordOwners].map(([chord, action]) => [chord, action]),
    ),
    actionBindings,
  };
}

export function keypressToChord(input, key = {}) {
  let name = String(key.name || "").toLowerCase();
  if (!name && typeof input === "string" && [...input].length === 1) {
    name = input.toLowerCase();
  }
  name = KEY_ALIASES.get(name) || name;
  if (name === " ") name = "space";
  if (!name) return null;
  const parts = [];
  if (key.ctrl) parts.push("ctrl");
  if (key.meta || key.alt) parts.push("alt");
  if (key.shift) parts.push("shift");
  parts.push(name);
  try {
    return normalizeKeyChord(parts.join("+"));
  } catch {
    return null;
  }
}

export function matchReplKeybinding(compiled, input, key) {
  const bindings =
    compiled?.bindings instanceof Map ? compiled.bindings : compiled;
  if (!(bindings instanceof Map)) return null;
  const chord = keypressToChord(input, key);
  return chord ? bindings.get(chord) || null : null;
}
