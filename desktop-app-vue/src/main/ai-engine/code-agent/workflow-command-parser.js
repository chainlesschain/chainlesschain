/**
 * Workflow command parser — parses `$skill-name [args]` prefix syntax.
 *
 * Borrowed from oh-my-codex's `$deep-interview` / `$ralplan` in-session
 * shortcuts. Recognizes only the 4 canonical workflow skills by default;
 * extra skills can be registered via allowSkills.
 *
 * Returns:
 *   { matched: true, skill, rest, flags, params } on match
 *   { matched: false } otherwise
 *
 * Examples:
 *   "$deep-interview \"add OAuth\""
 *     → { matched: true, skill: "deep-interview", rest: "add OAuth", flags: {} }
 *   "$ralplan --approve"
 *     → { matched: true, skill: "ralplan", rest: "", flags: { approve: true } }
 *   "$team 3:executor execute the plan"
 *     → { matched: true, skill: "team", rest: "3:executor execute the plan", flags: {} }
 *   "hello world"
 *     → { matched: false }
 */

const DEFAULT_ALLOWED = Object.freeze([
  "deep-interview",
  "ralplan",
  "ralph",
  "team",
]);

function stripOuterQuotes(s) {
  if (!s) {
    return s;
  }
  const trimmed = s.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFlags(tokens) {
  // Consume leading --flag / --flag=value tokens, return { flags, remainder }
  const flags = {};
  let i = 0;
  while (i < tokens.length && tokens[i].startsWith("--")) {
    const tok = tokens[i].slice(2);
    const eq = tok.indexOf("=");
    if (eq >= 0) {
      flags[tok.slice(0, eq)] = tok.slice(eq + 1);
    } else {
      flags[tok] = true;
    }
    i += 1;
  }
  return { flags, remainder: tokens.slice(i).join(" ") };
}

function parseWorkflowCommand(input, options = {}) {
  if (typeof input !== "string") {
    return { matched: false };
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("$")) {
    return { matched: false };
  }

  // Capture `$skill-name` then the rest
  const m = trimmed.match(/^\$([a-z][a-z0-9_-]*)\s*(.*)$/i);
  if (!m) {
    return { matched: false };
  }
  const skill = m[1].toLowerCase();
  const tail = m[2];

  const allowed = Array.isArray(options.allowSkills)
    ? options.allowSkills.map((s) => s.toLowerCase())
    : DEFAULT_ALLOWED;
  if (!allowed.includes(skill)) {
    return { matched: false };
  }

  // Simple tokenization preserving quoted segments as a single token
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(tail)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }

  const { flags, remainder } = parseFlags(tokens);
  const rest = stripOuterQuotes(remainder);

  // Derived params convenience layer
  const params = { ...flags };
  if (rest) {
    if (skill === "deep-interview") {
      params.goal = rest;
    } else if (skill === "ralplan") {
      params.title = rest;
    } else if (skill === "ralph") {
      params.note = rest;
    } else if (skill === "team") {
      params.spec = rest;
    }
  }

  return { matched: true, skill, rest, flags, params };
}

module.exports = {
  parseWorkflowCommand,
  DEFAULT_ALLOWED,
};
