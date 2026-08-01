#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = path.join(packageRoot, "src", "command-manifest.json");
const outputDir = path.join(packageRoot, "completions");
const checkOnly = process.argv.includes("--check");
const manifestText = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);

if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
  throw new Error("command-manifest.json must contain a non-empty commands[]");
}

const tokenPattern = /^[a-z0-9][a-z0-9-]*$/;
const tokens = [
  ...new Set(
    manifest.commands.flatMap((entry) => [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]),
  ),
].sort((left, right) => left.localeCompare(right));

for (const token of tokens) {
  if (typeof token !== "string" || !tokenPattern.test(token)) {
    throw new Error(`unsafe shell-completion token: ${JSON.stringify(token)}`);
  }
}

const manifestSha256 = crypto
  .createHash("sha256")
  .update(manifestText)
  .digest("hex");
const generatedHeader = (comment) =>
  `${comment} Generated from src/command-manifest.json; do not edit.\n` +
  `${comment} manifest-sha256: ${manifestSha256}\n`;

const bashWords = tokens.join(" ");
const bash = `${generatedHeader("#")}
_chainlesschain_complete() {
  local current
  current="${"${COMP_WORDS[COMP_CWORD]}"}"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W '${bashWords}' -- "$current") )
  else
    COMPREPLY=()
  fi
}
complete -F _chainlesschain_complete cc chainlesschain clc clchain
`;

const zsh = `${generatedHeader("#")}#compdef cc chainlesschain clc clchain

_chainlesschain() {
  if (( CURRENT == 2 )); then
    compadd -- \\
${tokens.map((token) => `      '${token}'`).join(" \\\n")}
  fi
}
compdef _chainlesschain cc chainlesschain clc clchain
`;

const fish = `${generatedHeader("#")}set -l chainlesschain_commands ${tokens
  .map((token) => `'${token}'`)
  .join(" ")}
for executable in cc chainlesschain clc clchain
  complete -c $executable -f -n '__fish_use_subcommand' -a "$chainlesschain_commands"
end
`;

const powershell = `${generatedHeader("#")}using namespace System.Management.Automation

$ChainlessChainCommands = @(
${tokens.map((token) => `  '${token}'`).join("\n")}
)

$ChainlessChainCompleter = {
  param($wordToComplete, $commandAst, $cursorPosition)
  if ($commandAst.CommandElements.Count -gt 2) { return }
  foreach ($candidate in $ChainlessChainCommands) {
    if ($candidate.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase)) {
      [CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
    }
  }
}.GetNewClosure()

Register-ArgumentCompleter -Native -CommandName cc,chainlesschain,clc,clchain -ScriptBlock $ChainlessChainCompleter
`;

const outputs = new Map([
  ["cc.bash", bash],
  ["_cc", zsh],
  ["cc.fish", fish],
  ["cc.ps1", powershell],
]);

let stale = false;
for (const [name, content] of outputs) {
  const destination = path.join(outputDir, name);
  if (checkOnly) {
    const current = fs.existsSync(destination)
      ? fs.readFileSync(destination, "utf8")
      : null;
    if (current !== content) {
      stale = true;
      console.error(`Shell completion is stale: completions/${name}`);
    }
    continue;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  if (
    !fs.existsSync(destination) ||
    fs.readFileSync(destination, "utf8") !== content
  ) {
    fs.writeFileSync(destination, content, "utf8");
  }
}

if (stale) {
  console.error("Run: npm run commands:completions");
  process.exitCode = 1;
} else if (checkOnly) {
  console.error(
    `Shell completions are current (${tokens.length} command tokens).`,
  );
} else {
  console.error(
    `Wrote ${outputs.size} shell completions (${tokens.length} command tokens).`,
  );
}
