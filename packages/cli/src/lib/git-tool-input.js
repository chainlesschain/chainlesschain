// The git tool accepts argv text, not a shell program. Diagnose shell syntax
// before spawning git while preserving literal operators in quoted arguments.
export function gitToolInputError(command) {
  if (/^\s*(?:git\s+)?gh(?:\.exe)?(?:\s|$)/i.test(command))
    return {
      success: false,
      code: "CC_GIT_WRONG_TOOL",
      error: "gh is the GitHub CLI, not a Git subcommand.",
      hint: "Use run_shell for the original gh command, subject to its normal permissions. Use the git tool only for Git arguments such as status or log. No command was executed.",
    };
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (char === "\\" && quote === '"') {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/[|&;<>\r\n`]/.test(char) || (char === "$" && command[i + 1] === "(")) {
      return {
        success: false,
        code: "CC_GIT_SHELL_SYNTAX",
        error:
          "The git tool accepts Git arguments only; shell operators are not executed.",
        hint: 'Submit one Git command without pipes, redirects or &&. For example: "merge-base --is-ancestor main HEAD" (inspect exitCode), "log -n 5 --oneline", or "tag --list v-npm-* --sort=-v:refname". Do not reroute to a shell or execute a partial command automatically.',
      };
    }
  }
  if (quote)
    return {
      success: false,
      code: "CC_GIT_UNCLOSED_QUOTE",
      error:
        "Unclosed quote in Git arguments. Close the quoted argument and retry.",
    };
  return null;
}
