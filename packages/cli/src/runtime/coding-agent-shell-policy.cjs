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

function evaluateShellCommandPolicy(command, options = {}) {
  const normalized = normalizeShellCommand(command);
  const tokens = tokenizeShellCommand(normalized);
  const firstToken = (tokens[0] || "").toLowerCase();
  const secondToken = (tokens[1] || "").toLowerCase();
  const context = {
    command: String(command || ""),
    normalized,
    tokens,
    firstToken,
    secondToken,
  };

  // Rule IDs that should be downgraded from DENY to WARN (e.g. cowork web-research)
  const overrideRuleIds = Array.isArray(options.overrideRuleIds)
    ? new Set(options.overrideRuleIds)
    : new Set();

  if (!normalized) {
    return {
      allowed: false,
      decision: SHELL_POLICY_DECISIONS.DENY,
      reason: "Shell command is required.",
      ruleId: "empty-command",
      normalizedCommand: normalized,
    };
  }

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

module.exports = {
  ALLOWLISTED_SHELL_RULES,
  BLOCKED_SHELL_RULES,
  SHELL_POLICY_DECISIONS,
  evaluateShellCommandPolicy,
  normalizeShellCommand,
  splitFirstCommandSegment,
  tokenizeShellCommand,
};
