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
  ...new Set(
    manifest.commands.flatMap((entry) => [
      entry.name,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ]),
  ),
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
      /compadd -- \\\n([\s\S]*?)\n\s{2}fi/,
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
