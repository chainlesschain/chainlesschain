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
const namespaces = Array.isArray(manifest.surface?.namespaces)
  ? manifest.surface.namespaces
  : [];
const tokens = [
  ...new Set([
    ...manifest.commands.flatMap((entry) => [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]),
    ...namespaces.map((namespace) => namespace.name),
  ]),
].sort((left, right) => left.localeCompare(right));

const namespaceTokens = new Map(
  namespaces.map((namespace) => [
    namespace.name,
    [...new Set(namespace.commands || [])].sort((left, right) =>
      left.localeCompare(right),
    ),
  ]),
);

for (const token of tokens) {
  if (typeof token !== "string" || !tokenPattern.test(token)) {
    throw new Error(`unsafe shell-completion token: ${JSON.stringify(token)}`);
  }
}
for (const [namespace, commands] of namespaceTokens) {
  if (!tokenPattern.test(namespace) || commands.length === 0) {
    throw new Error(`invalid command namespace: ${JSON.stringify(namespace)}`);
  }
  for (const command of commands) {
    if (
      !tokenPattern.test(command) ||
      !manifest.commands.some((entry) => entry.name === command)
    ) {
      throw new Error(
        `invalid ${namespace} completion command: ${JSON.stringify(command)}`,
      );
    }
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
const bashNamespaceCases = [...namespaceTokens]
  .map(
    ([namespace, commands]) =>
      `      '${namespace}') COMPREPLY=( $(compgen -W '${commands.join(" ")}' -- "$current") ) ;;`,
  )
  .join("\n");
const bash = `${generatedHeader("#")}
_chainlesschain_complete() {
  local current
  current="${"${COMP_WORDS[COMP_CWORD]}"}"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W '${bashWords}' -- "$current") )
  elif (( COMP_CWORD == 2 )); then
    case "${"${COMP_WORDS[1]}"}" in
${bashNamespaceCases}
      *) COMPREPLY=() ;;
    esac
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
  elif (( CURRENT == 3 )); then
    case "$words[2]" in
${[...namespaceTokens]
  .map(
    ([namespace, commands]) =>
      `      '${namespace}') compadd -- ${commands.map((command) => `'${command}'`).join(" ")} ;;`,
  )
  .join("\n")}
    esac
  fi
}
compdef _chainlesschain cc chainlesschain clc clchain
`;

const fish = `${generatedHeader("#")}set -l chainlesschain_commands ${tokens
  .map((token) => `'${token}'`)
  .join(" ")}
${[...namespaceTokens]
  .map(
    ([namespace]) => `
function __chainlesschain_needs_${namespace}_command
  set -l tokens (commandline -opc)
  test (count $tokens) -eq 2; and test "$tokens[2]" = '${namespace}'
end`,
  )
  .join("\n")}

for executable in cc chainlesschain clc clchain
  complete -c $executable -f -n '__fish_use_subcommand' -a "$chainlesschain_commands"
${[...namespaceTokens]
  .map(
    ([namespace, commands]) =>
      `  complete -c $executable -f -n '__chainlesschain_needs_${namespace}_command' -a '${commands.join(" ")}'`,
  )
  .join("\n")}
end
`;

const powershell =
  `${generatedHeader("#")}using namespace System.Management.Automation

$ChainlessChainCommands = @(
${tokens.map((token) => `  '${token}'`).join("\n")}
)

$ChainlessChainNamespaceCommands = @{
${[...namespaceTokens]
  .map(
    ([namespace, commands]) =>
      `  '${namespace}' = @(${commands.map((command) => `'${command}'`).join(", ")})`,
  )
  .join("\n")}
}

$ChainlessChainCompleter = {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  if ($elements.Count -eq 2 -and [String]::IsNullOrEmpty($wordToComplete) -and $ChainlessChainNamespaceCommands.ContainsKey($elements[1])) {
    $candidates = $ChainlessChainNamespaceCommands[$elements[1]]
  } elseif ($elements.Count -le 2) {
    $candidates = $ChainlessChainCommands
  } elseif ($elements.Count -eq 3 -and $ChainlessChainNamespaceCommands.ContainsKey($elements[1])) {
    $candidates = $ChainlessChainNamespaceCommands[$elements[1]]
  } else {
    return
  }
  foreach ($candidate in $candidates) {
    if ($candidate.StartsWith($wordToComplete, [StringComparison]::OrdinalIgnoreCase)) {
      [CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)
    }
  }
}.GetNewClosure()

Register-ArgumentCompleter -Native -CommandName cc,chainlesschain,clc,clchain -ScriptBlock $ChainlessChainCompleter
`.replaceAll("\n", "\r\n");

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
