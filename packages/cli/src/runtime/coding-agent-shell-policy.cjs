"use strict";

const SHELL_POLICY_DECISIONS = Object.freeze({
  ALLOW: "allow",
  DENY: "deny",
  WARN: "warn",
  REROUTE: "reroute",
});

const BLOCKED_SHELL_RULES = Object.freeze([
  {
    id: "dangerous-delete",
    decision: SHELL_POLICY_DECISIONS.DENY,
    // Unix (rm) AND Windows/PowerShell deletes. This repo is Windows-primary
    // (PowerShell is the default shell), where the `rm -rf` analog is
    // `Remove-Item -Recurse -Force` / its alias `ri` — neither shares a first
    // token with the Unix forms, so they must be listed explicitly. (`rm`/`del`
    // already cover PowerShell's `rm`/`del` aliases; `rd` covers `rmdir`.)
    test: ({ firstToken }) =>
      [
        "rm",
        "del",
        "erase",
        "rmdir",
        "rd",
        "remove-item",
        "ri",
      ].includes(firstToken),
    reason:
      "Destructive delete commands are blocked by the coding-agent shell policy.",
  },
  // The dangerous-git-* DENY rules MUST precede `git-tool-reroute` below:
  // `evaluateSegmentPolicy` returns the FIRST matching rule, and the reroute
  // rule matches every git command. Ordering reroute first (as it was) made
  // these DENYs unreachable dead code — a `git reset --hard && …` segment would
  // only REROUTE. Destructive git now hard-DENYs on the run_shell path; the git
  // tool itself separately confirms (isDangerousGitCommand) on its own path.
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
    id: "git-tool-reroute",
    decision: SHELL_POLICY_DECISIONS.REROUTE,
    test: ({ firstToken }) => firstToken === "git",
    reason:
      "Use the dedicated git tool instead of run_shell for repository operations.",
  },
  {
    // Infrastructure-as-Code teardown: `terraform destroy`, `pulumi destroy`,
    // `cdk destroy`, `terragrunt destroy` (and the `terraform apply -destroy`
    // flag variant). These tear down real cloud/infra resources and must not run
    // unprompted. Overridable (via overrideRuleIds) when the user explicitly
    // asks — mirrors Claude Code auto-mode safety for IaC destroy.
    id: "iac-destroy",
    decision: SHELL_POLICY_DECISIONS.DENY,
    test: ({ firstToken, tokens }) =>
      [
        "terraform",
        "terraform.exe",
        "terragrunt",
        "terragrunt.exe",
        "pulumi",
        "pulumi.exe",
        "cdk",
        "cdk.exe",
        "cdklocal",
      ].includes(firstToken) &&
      tokens.some((token) => {
        const t = token.toLowerCase();
        return t === "destroy" || t === "-destroy" || t === "--destroy";
      }),
    reason:
      "Infrastructure-as-Code destroy commands (terraform/pulumi/cdk/terragrunt) are blocked by the coding-agent shell policy unless explicitly requested.",
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
 * Strip the parts of a command segment that hide the real executable from
 * first-token classification: a leading subshell `(`/`{`, and leading env-var
 * assignments (`FOO=bar BAZ=qux cmd …` → `cmd …`). Without this, `x=1 rm -rf …`
 * would be classified by firstToken `x=1` (unclassified → WARN) instead of `rm`.
 */
function stripSegmentPrefix(segment) {
  let t = String(segment || "").trim();
  t = t.replace(/^[({]\s*/, ""); // leading subshell / group
  // leading VAR=value assignments (quoted or bare), one or more
  t = t.replace(/^(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
  return t.trim();
}

/**
 * Split a (possibly compound) command into the individual command segments the
 * policy must EACH inspect — not just the first — so a destructive command
 * (`rm -rf …`, `git reset --hard`) cannot be smuggled past a benign or
 * allowlisted leading segment.
 *
 * Covers every way a second command can ride along: the shell separators
 * `&& || | ; &` AND newlines, plus commands hidden inside command-substitution
 * `$(…)` / backticks (extracted as their own segments). Leading subshell parens
 * and env-var assignment prefixes are stripped per segment so the real
 * executable is what gets classified.
 */
function splitCommandSegments(command) {
  let s = String(command || "");
  const extracted = [];
  // Pull out command-substitution / backtick bodies as additional segments
  // (single level — nested substitutions are an accepted edge case).
  s = s.replace(/\$\(([^()]*)\)/g, (_m, inner) => {
    extracted.push(inner);
    return " ";
  });
  s = s.replace(/`([^`]*)`/g, (_m, inner) => {
    extracted.push(inner);
    return " ";
  });
  // Separators: && || | ; & and any newline.
  const parts = s.split(/(?:\|\||&&|[|;&]|[\r\n]+)/).concat(extracted);
  return parts
    .map((segment) => stripSegmentPrefix(segment))
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
