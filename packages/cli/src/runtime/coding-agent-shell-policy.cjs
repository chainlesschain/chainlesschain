"use strict";

const SHELL_POLICY_DECISIONS = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
  WARN: "warn",
  REROUTE: "reroute",
});

const BLOCKED_SHELL_RULES = Object.freeze([
  {
    id: "git-tool-reroute",
    decision: SHELL_POLICY_DECISIONS.REROUTE,
    test: ({ firstToken }) => firstToken === "git",
    reason:
      "Use the dedicated git tool instead of run_shell for repository operations.",
  },
  {
    id: "dangerous-delete",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken }) =>
      ["rm", "del", "erase", "rmdir", "rd"].includes(firstToken),
    reason:
      "Destructive delete commands are blocked by the coding-agent shell policy.",
  },
  {
    id: "dangerous-git-reset",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken, secondToken }) =>
      firstToken === "git" && secondToken === "reset",
    reason:
      "Potentially destructive git reset operations are blocked by the coding-agent shell policy.",
  },
  {
    id: "dangerous-git-checkout-discard",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken, tokens }) =>
      firstToken === "git" &&
      secondTokenIs(tokens, "checkout") &&
      tokens.includes("--"),
    reason:
      "Discard-style git checkout commands are blocked by the coding-agent shell policy.",
  },
  {
    id: "dangerous-git-clean",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken, secondToken }) =>
      firstToken === "git" && secondToken === "clean",
    reason:
      "git clean is blocked by the coding-agent shell policy.",
  },
  {
    id: "network-download",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken }) =>
      ["curl", "wget", "invoke-webrequest", "iwr"].includes(firstToken),
    reason:
      "Network download commands are blocked by the coding-agent shell policy.",
  },
  {
    id: "powershell-encoded-command",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken, tokens }) =>
      ["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(
        firstToken,
      ) &&
      tokens.some((token) =>
        ["-encodedcommand", "-enc"].includes(token.toLowerCase()),
      ),
    reason:
      "Encoded PowerShell commands are blocked by the coding-agent shell policy.",
  },
]);

const ALLOWLISTED_SHELL_RULES = Object.freeze([
  {
    id: "npm-test",
    test: ({ normalized }) =>
      /^(npm|npm\.cmd)\s+run\s+test(?::[\w:-]+)?(?:\s|$)/i.test(normalized),
    reason: "Package test runs are allowlisted verification commands.",
  },
  {
    id: "npm-lint",
    test: ({ normalized }) =>
      /^(npm|npm\.cmd)\s+run\s+lint(?:\s|$)/i.test(normalized),
    reason: "Package lint runs are allowlisted verification commands.",
  },
  {
    id: "npm-build",
    test: ({ normalized }) =>
      /^(npm|npm\.cmd)\s+run\s+build(?::[\w:-]+)?(?:\s|$)/i.test(normalized),
    reason: "Package build runs are allowlisted verification commands.",
  },
  {
    id: "playwright-single-file",
    test: ({ normalized }) =>
      /^npx\s+playwright\s+test\s+\S+(?:\s|$)/i.test(normalized),
    reason: "Single-file Playwright runs are allowlisted verification commands.",
  },
  {
    id: "ripgrep-search",
    test: ({ firstToken }) => firstToken === "rg",
    reason: "ripgrep search commands are allowlisted read-style commands.",
  },
]);

function secondTokenIs(tokens, value) {
  return (tokens[1] || "").toLowerCase() === value;
}

function splitFirstCommandSegment(command) {
  return String(command || "")
    .split(/(?:\|\||&&|[|;])/)[0]
    .trim();
}

/**
 * Split a (possibly compound) command on shell separators (`&&`, `||`, `|`,
 * `;`) into its individual command segments. The policy must inspect EVERY
 * segment — not just the first — so a destructive command (`rm -rf …`,
 * `git reset --hard`) cannot be smuggled after a separator behind a benign or
 * allowlisted leading segment (e.g. `npm run build && git checkout -- .`).
 */
function splitCommandSegments(command) {
  return String(command || "")
    .split(/(?:\|\||&&|[|;])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenizeShellCommand(command) {
  const tokens = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let escaping = false;

  for (const ch of String(command || "")) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\" && !inSingle) {
      escaping = true;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if ((ch === " " || ch === "\t") && !inDouble && !inSingle) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeShellCommand(command) {
  return splitFirstCommandSegment(command).replace(/\s+/g, " ").trim();
}

// Severity ordering so the most restrictive segment of a compound command wins.
const DECISION_SEVERITY = Object.freeze({
  [SHELL_POLICY_DECISIONS.DENY]: 3,
  [SHELL_POLICY_DECISIONS.REROUTE]: 2,
  [SHELL_POLICY_DECISIONS.WARN]: 1,
  [SHELL_POLICY_DECISIONS.ALLOW]: 0,
});

/** Classify ONE command segment (no separators). */
function evaluateSegmentPolicy(segment, overrideRuleIds) {
  const normalized = normalizeShellCommand(segment);
  const tokens = tokenizeShellCommand(normalized);
  const firstToken = (tokens[0] || "").toLowerCase();
  const secondToken = (tokens[1] || "").toLowerCase();
  const context = {
    command: String(segment || ""),
    normalized,
    tokens,
    firstToken,
    secondToken,
  };

  const blockedRule = BLOCKED_SHELL_RULES.find((rule) => rule.test(context));
  if (blockedRule) {
    // If the rule is overridden, downgrade from DENY to WARN (allowed)
    if (overrideRuleIds.has(blockedRule.id)) {
      return {
        allowed: true,
        decision: SHELL_POLICY_DECISIONS.WARN,
        reason: `${blockedRule.reason} (overridden by session policy)`,
        ruleId: blockedRule.id,
        normalizedCommand: normalized,
      };
    }
    return {
      allowed: false,
      decision: blockedRule.decision,
      reason: blockedRule.reason,
      ruleId: blockedRule.id,
      normalizedCommand: normalized,
    };
  }

  const allowlistedRule = ALLOWLISTED_SHELL_RULES.find((rule) =>
    rule.test(context),
  );
  if (allowlistedRule) {
    return {
      allowed: true,
      decision: SHELL_POLICY_DECISIONS.ALLOW,
      reason: allowlistedRule.reason,
      ruleId: allowlistedRule.id,
      normalizedCommand: normalized,
    };
  }

  return {
    allowed: true,
    decision: SHELL_POLICY_DECISIONS.WARN,
    reason:
      "Command is not on the preferred verification allowlist, but it is not explicitly blocked.",
    ruleId: "unclassified-command",
    normalizedCommand: normalized,
  };
}

function evaluateShellCommandPolicy(command, options = {}) {
  // Rule IDs that should be downgraded from DENY to WARN (e.g. cowork web-research)
  const overrideRuleIds = Array.isArray(options.overrideRuleIds)
    ? new Set(options.overrideRuleIds)
    : new Set();

  // Inspect EVERY segment of a compound command, not just the first — a
  // dangerous segment after `&&` / `;` / `|` must still be caught. The most
  // restrictive segment decides the whole command (a compound is only ALLOW
  // when every segment is independently allowlisted).
  const segments = splitCommandSegments(command);
  if (!segments.length) {
    return {
      allowed: false,
      decision: SHELL_POLICY_DECISIONS.DENY,
      reason: "Shell command is required.",
      ruleId: "empty-command",
      normalizedCommand: "",
    };
  }

  let worst = null;
  for (const segment of segments) {
    const result = evaluateSegmentPolicy(segment, overrideRuleIds);
    const sev = DECISION_SEVERITY[result.decision] ?? 1;
    const worstSev = worst ? (DECISION_SEVERITY[worst.decision] ?? 1) : -1;
    if (sev > worstSev) worst = result;
  }
  return worst;
}

module.exports = {
  ALLOWLISTED_SHELL_RULES,
  BLOCKED_SHELL_RULES,
  SHELL_POLICY_DECISIONS,
  evaluateShellCommandPolicy,
  normalizeShellCommand,
  splitFirstCommandSegment,
  splitCommandSegments,
  tokenizeShellCommand,
};
