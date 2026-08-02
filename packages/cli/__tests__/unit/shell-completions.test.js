import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const manifestPath = path.join(packageRoot, "src", "command-manifest.json");
const manifestText = fs.readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestText);
const expectedTokens = [
  ...new Set([
    ...manifest.commands.flatMap((entry) => [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]),
    ...(manifest.surface?.namespaces || []).map((namespace) => namespace.name),
  ]),
].sort((left, right) => left.localeCompare(right));
const expectedSha256 = crypto
  .createHash("sha256")
  .update(manifestText)
  .digest("hex");

function completion(name) {
  return fs.readFileSync(path.join(packageRoot, "completions", name), "utf8");
}

function quotedTokens(text) {
  return [...text.matchAll(/'([a-z0-9][a-z0-9-]*)'/g)].map((match) => match[1]);
}

describe("generated shell completions", () => {
  it("is current and records the exact command manifest digest", () => {
    execFileSync(process.execPath, [
      path.join(packageRoot, "scripts", "gen-shell-completions.mjs"),
      "--check",
    ]);

    for (const name of ["cc.bash", "_cc", "cc.fish", "cc.ps1"]) {
      expect(completion(name)).toContain(`manifest-sha256: ${expectedSha256}`);
    }
  });

  it("exports every command and alias exactly once for each shell", () => {
    const bashWords = completion("cc.bash").match(/compgen -W '([^']*)'/)?.[1];
    expect(bashWords?.split(" ")).toEqual(expectedTokens);

    const zshBody = completion("_cc").match(
      /compadd -- \\\n([\s\S]*?)\n\s{2}elif/,
    )?.[1];
    expect(quotedTokens(zshBody ?? "")).toEqual(expectedTokens);

    const fishWords = completion("cc.fish").match(
      /set -l chainlesschain_commands (.*)/,
    )?.[1];
    expect(quotedTokens(fishWords ?? "")).toEqual(expectedTokens);

    const powershellWords = completion("cc.ps1").match(
      /\$ChainlessChainCommands = @\(\n([\s\S]*?)\n\)/,
    )?.[1];
    expect(quotedTokens(powershellWords ?? "")).toEqual(expectedTokens);
  });

  it("completes manifest-defined compatibility namespace children", () => {
    const namespace = manifest.surface.namespaces.find(
      (candidate) => candidate.name === "lab",
    );
    expect(namespace.commands).toEqual(["dao", "evomap"]);

    for (const name of ["cc.bash", "_cc", "cc.fish", "cc.ps1"]) {
      const text = completion(name);
      expect(text).toContain("lab");
      expect(text).toContain("dao");
      expect(text).toContain("evomap");
    }
    expect(completion("cc.bash")).toContain(
      "'lab') COMPREPLY=( $(compgen -W 'dao evomap'",
    );
    expect(completion("_cc")).toContain("'lab') compadd -- 'dao' 'evomap'");
    expect(completion("cc.fish")).toContain(
      "__chainlesschain_needs_lab_command",
    );
    expect(completion("cc.ps1")).toContain("'lab' = @('dao', 'evomap')");
    expect(completion("cc.ps1")).toContain(
      "$elements.Count -eq 2 -and [String]::IsNullOrEmpty($wordToComplete)",
    );
  });

  it("ships the generated files and checks drift in CI and prepublish", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    );
    expect(packageJson.files).toContain("completions/");
    expect(packageJson.scripts.prepublishOnly).toContain(
      "npm run commands:completions:check",
    );

    const cliCi = fs.readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "cli-ci.yml"),
      "utf8",
    );
    expect(cliCi).toContain("npm run commands:completions:check");
  });
});
